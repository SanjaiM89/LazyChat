#include "mcp.h"

#include <QEventLoop>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QTimer>

#include "datastore.h"

namespace omnia {

static QByteArray frame(const QByteArray& payload) {
  return "Content-Length: " + QByteArray::number(payload.size()) + "\r\n\r\n" + payload;
}

McpConnection::McpConnection(const MCPServerDef& def, QObject* parent) : QObject(parent), def_(def) {}

McpConnection::~McpConnection() { disconnectFromServer(); }

void McpConnection::disconnectFromServer() {
  if (proc_) {
    if (proc_->state() != QProcess::NotRunning) {
      proc_->write(frame(QJsonDocument(QJsonObject{{"jsonrpc", "2.0"}, {"id", nextId_++},
                                                   {"method", "notifications/initialized"}})
                             .toJson(QJsonDocument::Compact)));
      proc_->kill();
      proc_->waitForFinished(2000);
    }
    proc_->deleteLater();
    proc_ = nullptr;
  }
  connected_ = false;
}

QJsonValue McpConnection::rpc(const QString& method, const QJsonValue& params, int timeoutMs) {
  if (!proc_) return {};
  const int id = nextId_++;
  QJsonObject msg{{"jsonrpc", "2.0"}, {"id", id}, {"method", method}};
  if (!params.isUndefined()) msg.insert("params", params);
  proc_->write(frame(QJsonDocument(msg).toJson(QJsonDocument::Compact)));

  QEventLoop loop;
  QTimer timer;
  timer.setSingleShot(true);
  QObject::connect(&timer, &QTimer::timeout, &loop, &QEventLoop::quit);
  QByteArray buffer;
  QJsonValue result;
  QJsonObject error;

  auto tryParse = [&](QByteArray& buf) -> bool {
    while (true) {
      const int headerEnd = buf.indexOf("\r\n\r\n");
      if (headerEnd < 0) return false;
      const QByteArray head = buf.left(headerEnd);
      int len = -1;
      for (const QByteArray& line : head.split('\n')) {
        const QByteArray t = line.trimmed();
        if (t.toLower().startsWith("content-length:"))
          len = t.mid(t.indexOf(':') + 1).trimmed().toInt();
      }
      if (len < 0 || buf.size() < headerEnd + 4 + len) return false;
      const QByteArray payload = buf.mid(headerEnd + 4, len);
      buf.remove(0, headerEnd + 4 + len);
      const QJsonObject o = QJsonDocument::fromJson(payload).object();
      if (o.value("id").toInt() == id) {
        if (o.contains("error")) error = o.value("error").toObject();
        result = o.value("result");
        return true;
      }
    }
  };

  auto onData = [&] {
    buffer += proc_->readAll();
    if (tryParse(buffer)) loop.quit();
  };
  QObject::connect(proc_, &QProcess::readyReadStandardOutput, &loop, onData);
  timer.start(timeoutMs);
  loop.exec();

  if (!error.isEmpty()) return QJsonValue(error);
  return result;
}

bool McpConnection::connectToServer(int timeoutMs) {
  disconnectFromServer();
  if (def_.type == "http") {
    QNetworkAccessManager nam;
    QNetworkRequest req{QUrl(def_.url)};
    req.setTransferTimeout(timeoutMs);
    req.setRawHeader("Content-Type", "application/json");
    req.setRawHeader("Accept", "application/json, text/event-stream");
    const QByteArray init =
        QJsonDocument(QJsonObject{{"jsonrpc", "2.0"},
                                  {"id", 1},
                                  {"method", "initialize"},
                                  {"params",
                                   QJsonObject{{"protocolVersion", "2024-11-05"},
                                               {"capabilities", QJsonObject{}},
                                               {"clientInfo",
                                                QJsonObject{{"name", "omnia-desktop"},
                                                            {"version", "0.1.0"}}}}}})
            .toJson();
    QNetworkReply* reply = nam.post(req, init);
    QEventLoop loop;
    QObject::connect(reply, &QNetworkReply::finished, &loop, &QEventLoop::quit);
    loop.exec();
    const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
    reply->deleteLater();
    connected_ = status >= 200 && status < 300;
    if (connected_) {
      QNetworkRequest treq{QUrl(def_.url)};
      treq.setTransferTimeout(timeoutMs);
      treq.setRawHeader("Content-Type", "application/json");
      treq.setRawHeader("Accept", "application/json, text/event-stream");
      const QByteArray tl =
          QJsonDocument(QJsonObject{{"jsonrpc", "2.0"}, {"id", 2}, {"method", "tools/list"}}).toJson();
      QNetworkReply* tr = nam.post(treq, tl);
      QEventLoop loop2;
      QObject::connect(tr, &QNetworkReply::finished, &loop2, &QEventLoop::quit);
      loop2.exec();
      QByteArray body = tr->readAll();
      tr->deleteLater();
      if (body.contains("data:")) {
        QByteArray dataLine;
        for (const QByteArray& line : body.split('\n'))
          if (line.startsWith("data:")) dataLine = line.mid(5);
        body = dataLine.trimmed();
      }
      const QJsonObject ro = QJsonDocument::fromJson(body).object();
      for (const QJsonValue& v : ro.value("result").toObject().value("tools").toArray()) {
        const QJsonObject to = v.toObject();
        MCPToolInfo info;
        info.server = def_.name;
        info.name = to.value("name").toString();
        info.description = to.value("description").toString();
        info.inputSchema = to.value("inputSchema").toObject();
        tools_.push_back(info);
      }
    }
    emit statusChanged(connected_ ? "connected" : "error");
    return connected_;
  }

  proc_ = new QProcess(this);
  proc_->setProgram(def_.command);
  proc_->setArguments(def_.args);
  QProcessEnvironment env = QProcessEnvironment::systemEnvironment();
  for (auto it = def_.env.begin(); it != def_.env.end(); ++it)
    env.insert(it.key(), it.value());
  proc_->setProcessEnvironment(env);
  proc_->start();
  if (!proc_->waitForStarted(4000)) {
    emit statusChanged("error");
    return false;
  }
  rpc("initialize",
      QJsonObject{{"protocolVersion", "2024-11-05"},
                  {"capabilities", QJsonObject{}},
                  {"clientInfo", QJsonObject{{"name", "omnia-desktop"}, {"version", "0.1.0"}}}},
      timeoutMs);
  proc_->write(frame(QJsonDocument(QJsonObject{{"jsonrpc", "2.0"},
                                                {"method", "notifications/initialized"}})
                          .toJson(QJsonDocument::Compact)));
  const QJsonValue res = rpc("tools/list", QJsonObject{}, timeoutMs);
  tools_.clear();
  for (const QJsonValue& v : res.toObject().value("tools").toArray()) {
    const QJsonObject to = v.toObject();
    MCPToolInfo info;
    info.server = def_.name;
    info.name = to.value("name").toString();
    info.description = to.value("description").toString();
    info.inputSchema = to.value("inputSchema").toObject();
    tools_.push_back(info);
  }
  connected_ = proc_->state() == QProcess::Running;
  emit statusChanged(connected_ ? "connected" : "error");
  return connected_;
}

QJsonValue McpConnection::callTool(const QString& name, const QJsonObject& args) {
  if (def_.type == "http") {
    QNetworkAccessManager nam;
    QNetworkRequest req{QUrl(def_.url)};
    req.setTransferTimeout(30000);
    req.setRawHeader("Content-Type", "application/json");
    req.setRawHeader("Accept", "application/json, text/event-stream");
    const QByteArray body =
        QJsonDocument(QJsonObject{{"jsonrpc", "2.0"},
                                  {"id", 3},
                                  {"method", "tools/call"},
                                  {"params", QJsonObject{{"name", name}, {"arguments", args}}}})
            .toJson();
    QNetworkReply* reply = nam.post(req, body);
    QEventLoop loop;
    QObject::connect(reply, &QNetworkReply::finished, &loop, &QEventLoop::quit);
    loop.exec();
    QByteArray out = reply->readAll();
    reply->deleteLater();
    if (out.contains("data:")) {
      for (const QByteArray& line : out.split('\n'))
        if (line.startsWith("data:")) out = line.mid(5).trimmed();
    }
    return QJsonDocument::fromJson(out).object().value("result");
  }
  return rpc("tools/call",
             QJsonObject{{"name", name}, {"arguments", args}});
}

McpRegistry& McpRegistry::instance() {
  static McpRegistry r;
  return r;
}

McpRegistry::McpRegistry() : QObject(nullptr) {}

QVector<MCPServerDef> McpRegistry::servers() const { return listMcpServers(); }

void McpRegistry::saveServers(const QVector<MCPServerDef>& servers) {
  saveMcpServers(servers);
  emit changed();
}

bool McpRegistry::addServer(const MCPServerDef& def) {
  auto list = servers();
  for (auto& s : list)
    if (s.id == def.id) {
      s = def;
      saveServers(list);
      return true;
    }
  list.push_back(def);
  saveServers(list);
  return true;
}

bool McpRegistry::removeServer(const QString& id) {
  if (conns_.contains(id)) {
    conns_.value(id)->deleteLater();
    conns_.remove(id);
  }
  auto list = servers();
  for (int i = 0; i < list.size(); ++i)
    if (list[i].id == id) {
      list.removeAt(i);
      saveServers(list);
      return true;
    }
  return false;
}

bool McpRegistry::setEnabled(const QString& id, bool enabled) {
  auto list = servers();
  for (auto& s : list)
    if (s.id == id) {
      s.enabled = enabled;
      saveServers(list);
      reconnectAll();
      return true;
    }
  return false;
}

void McpRegistry::reconnectAll() {
  for (auto it = conns_.begin(); it != conns_.end(); ++it) {
    it.value()->disconnectFromServer();
    it.value()->deleteLater();
  }
  conns_.clear();
  for (const auto& s : servers()) {
    if (!s.enabled) continue;
    auto* c = new McpConnection(s, this);
    if (c->connectToServer()) conns_.insert(s.id, c);
    else c->deleteLater();
  }
  emit changed();
}

QVector<MCPToolInfo> McpRegistry::allTools() {
  QVector<MCPToolInfo> out;
  for (auto* c : conns_) out += c->tools();
  return out;
}

}  // namespace omnia
