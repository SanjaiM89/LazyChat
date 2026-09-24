#include "sandbox.h"

#include <QCoreApplication>
#include <QDir>
#include <QEventLoop>
#include <QFile>
#include <QFileInfo>
#include <QHostAddress>
#include <QJsonArray>
#include <QJsonObject>
#include <QNetworkInterface>
#include <QProcess>
#include <QRegularExpression>
#include <QTcpServer>
#include <QTcpSocket>
#include <QTimer>

#include "datastore.h"

namespace omnia {

QString docker(const QStringList& args, int timeoutMs, int* exitCode) {
  QProcess p;
  p.start("docker", args);
  if (!p.waitForStarted(timeoutMs)) {
    if (exitCode) *exitCode = -1;
    return {};
  }
  if (!p.waitForFinished(timeoutMs)) {
    p.kill();
    p.waitForFinished(3000);
    if (exitCode) *exitCode = -2;
    return QString::fromUtf8(p.readAllStandardOutput());
  }
  if (exitCode) *exitCode = p.exitCode();
  return QString::fromUtf8(p.readAllStandardOutput());
}

SandboxService& SandboxService::instance() {
  static SandboxService s;
  return s;
}

SandboxService::SandboxService() : QObject(nullptr) {
  server_ = new QTcpServer(this);
  const int envPort = qEnvironmentVariableIntValue("SANDBOX_EVENTS_PORT");
  port_ = quint16(envPort > 0 ? envPort : 8790);
  connect(server_, &QTcpServer::newConnection, this, [this] {
    while (QTcpSocket* sock = server_->nextPendingConnection()) {
      connect(sock, &QTcpSocket::readyRead, this, [this, sock] {
        const QByteArray req = sock->readAll();
        const int headerEnd = req.indexOf("\r\n\r\n");
        if (headerEnd < 0) return;
        const QByteArray head = req.left(headerEnd);
        const QByteArray body = req.mid(headerEnd + 4);
        const QString firstLine = QString::fromLatin1(head).section('\n', 0, 0).trimmed();
        const QStringList parts = firstLine.split(' ');
        if (parts.size() < 2 || parts[0] != "POST") {
          sock->write("HTTP/1.1 405 Method Not Allowed\r\nConnection: close\r\n\r\n");
          sock->disconnectFromHost();
          return;
        }
        const QString path = parts[1];
        QRegularExpressionMatch m =
            QRegularExpression("^/agent-events/([^/]+)").match(path);
        if (m.hasMatch()) {
          const QString agentId = m.captured(1);
          const QJsonDocument doc = QJsonDocument::fromJson(body);
          if (doc.isObject()) emit agentEvent(agentId, doc.object());
          sock->write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n"
                      "Content-Length: 2\r\nConnection: close\r\n\r\n{}");
        } else {
          sock->write("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        }
        sock->disconnectFromHost();
      });
    }
  });
  if (!server_->listen(QHostAddress::LocalHost, port_)) {
    port_ = 0;
    if (!server_->listen()) port_ = server_->serverPort();
  }
}

QString SandboxService::receiverUrl() const {
  return "http://127.0.0.1:" + QString::number(port_);
}

SandboxHealth SandboxService::health() {
  SandboxHealth h;
  int code = 0;
  const QString ver = docker({"info", "--format", "{{.ServerVersion}}"}, 8000, &code);
  h.docker = code == 0 && !ver.trimmed().isEmpty();
  h.version = ver.trimmed();
  if (!h.docker) return h;
  const QString imgs = docker({"images", "--format", "{{.Repository}}:{{.Tag}}"}, 10000, &code);
  for (const QString& line : imgs.split('\n', Qt::SkipEmptyParts))
    if (!line.startsWith("<none>")) h.images << line.trimmed();
  const QString ps = docker({"ps", "-q", "--filter", "name=omnia-"}, 8000, &code);
  h.activeContainers = ps.split('\n', Qt::SkipEmptyParts).size();
  h.ok = true;
  return h;
}

QString SandboxService::containerName(const QString& id) const { return "omnia-" + id; }

QMap<QString, QString> SandboxService::filteredEnv(const QMap<QString, QString>& env) const {
  static const QRegularExpression allowed(
      "^(AGENT|OMNIA|ANTHROPIC|OPENAI|GOOGLE|GEMINI|OLLAMA|LMSTUDIO|DEEPSEEK|GROQ|XAI|MISTRAL|"
      "OPENROUTER|AZURE|GITHUB|FIREWORKS|TOGETHER|NVIDIA|AWS|SANDBOX|HTTP_PROXY|HTTPS_PROXY|"
      "ALL_PROXY|NO_PROXY)_|_API_KEY$|_BASE_URL$|_API_KEY_ID$|_SECRET$|_TOKEN$");
  QMap<QString, QString> out;
  for (auto it = env.begin(); it != env.end(); ++it) {
    if (allowed.match(it.key()).hasMatch()) out.insert(it.key(), it.value());
  }
  for (const QString& k : {"ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY",
                           "OPENCODE_API_KEY", "OLLAMA_BASE_URL", "LMSTUDIO_BASE_URL"}) {
    const auto stored = DataStore::providerKeys();
    for (auto it = stored.begin(); it != stored.end(); ++it) {
      if (it.key() == "anthropic" && QString(k) == "ANTHROPIC_API_KEY") out.insert(k, it.value());
      if (it.key() == "openai" && QString(k) == "OPENAI_API_KEY") out.insert(k, it.value());
      if ((it.key() == "google") && QString(k) == "GOOGLE_GENERATIVE_AI_API_KEY")
        out.insert(k, it.value());
      if (it.key() == "opencode" && QString(k) == "OPENCODE_API_KEY") out.insert(k, it.value());
    }
    const QByteArray kBa = k.toLatin1();
    const QString envVal = qEnvironmentVariable(kBa.constData());
    if (!envVal.isEmpty() && !out.contains(k)) out.insert(k, envVal);
  }
  out.insert("SANDBOX_HOST", receiverUrl());
  return out;
}

SandboxMeta SandboxService::createSandbox(const QString& label, const QMap<QString, QString>& env,
                                          const QString& runnerCommand) {
  SandboxMeta meta;
  meta.id = newId(8);
  meta.label = label;
  meta.status = "created";
  meta.createdAt = nowMs();
  meta.image = qEnvironmentVariable("SANDBOX_IMAGE", "omnia-sandbox:latest");

  const QString root = DataStore::dataDir() + "/sandboxes/" + meta.id;
  QDir().mkpath(root + "/workspace");
  const QString envFile = root + "/container.env";
  {
    QFile f(envFile);
    if (f.open(QIODevice::WriteOnly | QIODevice::Truncate)) {
      const auto filtered = filteredEnv(env);
      for (auto it = filtered.begin(); it != filtered.end(); ++it)
        f.write(it.key().toUtf8() + "=" + it.value().toUtf8() + "\n");
      f.close();
    }
  }
  int code = 0;
  docker({"rm", "-f", containerName(meta.id)}, 20000, &code);
  QStringList args = {"run", "-d", "--name", containerName(meta.id),
                      "--network", "host",
                      "-m", "4g",
                      "--cpus", "2",
                      "--env-file", envFile,
                      "-v", root + "/workspace:/workspace",
                      "-w", "/workspace",
                      meta.image};
  if (!runnerCommand.isEmpty()) {
    const QStringList shell = {"sh", "-lc", runnerCommand};
    args.append(shell);
  } else {
    args.append(QStringList{"sleep", "infinity"});
  }
  const QString out = docker(args, 60000, &code);
  meta.status = code == 0 && !out.trimmed().isEmpty() ? "running" : "error";
  return meta;
}

QVector<SandboxMeta> SandboxService::listSandboxes() {
  QVector<SandboxMeta> out;
  int code = 0;
  const QString ps =
      docker({"ps", "-a", "--filter", "name=omnia-", "--format",
              "{{.Names}}|{{.Status}}|{{.Image}}|{{.CreatedAt}}"},
             10000, &code);
  for (const QString& line : ps.split('\n', Qt::SkipEmptyParts)) {
    const QStringList cols = line.split('|');
    if (cols.size() < 3) continue;
    SandboxMeta m;
    m.id = cols[0];
    m.id.remove("omnia-");
    m.label = m.id;
    m.status = cols[1].toLower().contains("up") ? "running" : "stopped";
    m.image = cols[2];
    m.createdAt = nowMs();
    const QString shotFile = DataStore::dataDir() + "/sandboxes/" + m.id + "/last-shot.txt";
    QFile f(shotFile);
    if (f.open(QIODevice::ReadOnly)) {
      m.lastScreenshot = QString::fromUtf8(f.readAll());
      f.close();
    }
    out.push_back(m);
  }
  return out;
}

bool SandboxService::startSandbox(const QString& id) {
  int code = 0;
  docker({"start", containerName(id)}, 20000, &code);
  return code == 0;
}

bool SandboxService::killSandbox(const QString& id) {
  int code = 0;
  docker({"stop", "-t", "5", containerName(id)}, 20000, &code);
  return code == 0;
}

bool SandboxService::deleteSandbox(const QString& id) {
  int code = 0;
  docker({"rm", "-f", containerName(id)}, 20000, &code);
  return code == 0;
}

SandboxService::ExecResult SandboxService::exec(const QString& id, const QString& command,
                                                int timeoutMs) {
  ExecResult r;
  int code = 0;
  const QString out = docker({"exec", "-w", "/workspace", containerName(id), "sh", "-lc", command},
                             timeoutMs, &code);
  r.exitCode = code;
  r.output = out;
  return r;
}

bool SandboxService::writeFile(const QString& id, const QString& path, const QByteArray& content) {
  const QString tmp = QDir::tempPath() + "/omnia-write-" + newId(6);
  QFile f(tmp);
  if (!f.open(QIODevice::WriteOnly)) return false;
  f.write(content);
  f.close();
  int code = 0;
  docker({"cp", tmp, containerName(id) + ":" + path}, 30000, &code);
  QFile::remove(tmp);
  return code == 0;
}

QByteArray SandboxService::readFile(const QString& id, const QString& path) {
  const QString tmp = QDir::tempPath() + "/omnia-read-" + newId(6);
  int code = 0;
  docker({"cp", containerName(id) + ":" + path, tmp}, 30000, &code);
  QByteArray data;
  QFile f(tmp);
  if (f.open(QIODevice::ReadOnly)) {
    data = f.readAll();
    f.close();
  }
  QFile::remove(tmp);
  return data;
}

QJsonArray SandboxService::listFiles(const QString& id, const QString& path) {
  const ExecResult r = exec(id, "find " + path + " -maxdepth 3 -type f 2>/dev/null | head -200");
  QJsonArray out;
  for (const QString& line : r.output.split('\n', Qt::SkipEmptyParts)) {
    const QString p = line.trimmed();
    QJsonObject o;
    o.insert("path", p);
    o.insert("name", p.section('/', -1));
    out.append(o);
  }
  return out;
}

bool SandboxService::copyOut(const QString& id, const QString& remotePath, const QString& localPath) {
  int code = 0;
  docker({"cp", containerName(id) + ":" + remotePath, localPath}, 30000, &code);
  return code == 0;
}

}  // namespace omnia
