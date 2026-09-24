#include "agents.h"

#include <QDir>
#include <QFile>
#include <QJsonArray>
#include <QRegularExpression>

#include "artifacts.h"
#include "datastore.h"
#include "models.h"
#include "sandbox.h"

namespace omnia {

QString agentRunnerCommand(const QString& agentId, const QString& provider, const QString& model,
                           const QString& engine) {
  return "node /app/runner.mjs " + agentId + " " + provider + " " + model + " " +
         (engine.isEmpty() ? "tool-loop" : engine);
}

AgentsService& AgentsService::instance() {
  static AgentsService s;
  return s;
}

AgentsService::AgentsService() : QObject(nullptr) {
  connect(&SandboxService::instance(), &SandboxService::agentEvent, this,
          &AgentsService::onEvent);
  cleanupFinished();
}

QVector<AgentMeta> AgentsService::list() {
  QVector<AgentMeta> out = agents_.values();
  std::sort(out.begin(), out.end(), [](const AgentMeta& a, const AgentMeta& b) {
    return a.createdAt > b.createdAt;
  });
  return out;
}

AgentMeta AgentsService::get(const QString& id) { return agents_.value(id); }

static const QRegularExpression RESEARCH_RE(
    "\\b(research(?:ing|ed)?|investigat\\w+|deep ?dive|deep ?research|current events|briefing)\\b",
    QRegularExpression::CaseInsensitiveOption);

AgentMeta AgentsService::spawn(const QString& task, const QString& provider, const QString& model,
                               const QString& engine, const QString& label, bool research) {
  AgentMeta a;
  a.id = newId(8);
  a.task = task;
  a.provider = provider.isEmpty() ? "anthropic" : provider;
  a.model = model.isEmpty() ? getDefaultModel(a.provider) : model;
  a.engine = engine.isEmpty() ? "tool-loop" : engine;
  a.label = label.isEmpty() ? task.left(48) : label;
  a.research = research || task.contains(RESEARCH_RE);
  a.status = "starting";
  a.createdAt = a.updatedAt = nowMs();
  agents_.insert(a.id, a);

  QMap<QString, QString> env;
  env.insert("AGENT_TASK", task);
  env.insert("SANDBOX_ID", a.id);
  env.insert("SANDBOX_LABEL", a.label);
  if (a.research) env.insert("AGENT_MODE", "research");
  if (a.provider == "opencode") {
    env.insert("OPENCODE_API_KEY", resolveApiKey("opencode"));
    env.insert("OPENCODE_BASE_URL", resolveBaseUrl("opencode"));
  }
  env.insert("ANTHROPIC_API_KEY", resolveApiKey("anthropic"));
  env.insert("OPENAI_API_KEY", resolveApiKey("openai"));
  env.insert("GOOGLE_GENERATIVE_AI_API_KEY", resolveApiKey("google"));
  env.insert("OLLAMA_BASE_URL", resolveBaseUrl("ollama"));
  env.insert("LMSTUDIO_BASE_URL", resolveBaseUrl("lmstudio"));

  const SandboxMeta sm = SandboxService::instance().createSandbox(
      "agent:" + a.label, env, agentRunnerCommand(a.id, a.provider, a.model, a.engine));
  a.status = sm.status == "running" ? "running" : "error";
  if (a.status == "error") a.error = "failed to start container";
  a.updatedAt = nowMs();
  agents_.insert(a.id, a);
  emit changed(a.id);
  return a;
}

bool AgentsService::stop(const QString& id) {
  SandboxService::instance().deleteSandbox(id);
  if (agents_.contains(id)) {
    auto& a = agents_[id];
    a.status = "stopped";
    a.updatedAt = nowMs();
    emit changed(id);
    return true;
  }
  return false;
}

void AgentsService::cleanupFinished(qint64 maxAgeMs) {
  const qint64 now = nowMs();
  QStringList remove;
  for (auto it = agents_.begin(); it != agents_.end(); ++it) {
    const bool terminal = it->status == "done" || it->status == "error" || it->status == "stopped";
    if (terminal && now - it->updatedAt > maxAgeMs) remove << it.key();
  }
  for (const QString& id : remove) {
    agents_.remove(id);
    SandboxService::instance().deleteSandbox(id);
  }
}

void AgentsService::onEvent(const QString& id, const QJsonObject& e) {
  if (!agents_.contains(id)) {
    AgentMeta a;
    a.id = id;
    a.task = e.value("task").toString();
    a.label = a.task.left(48);
    a.status = "running";
    a.createdAt = a.updatedAt = nowMs();
    agents_.insert(id, a);
  }
  auto& a = agents_[id];
  a.updatedAt = nowMs();
  const QString type = e.value("type").toString();
  if (type == "log" || type == "tool" || type == "thinking" || type == "text" ||
      type == "progress" || type == "status" || type == "file" || type == "error") {
    QJsonObject entry = e;
    entry.insert("t", double(a.updatedAt));
    a.logs.push_back(entry);
    while (a.logs.size() > 400) a.logs.removeFirst();
  }
  if (type == "screenshot") a.lastScreenshot = e.value("image").toString();
  if (type == "status") {
    const QString v = e.value("value").toString();
    if (!v.isEmpty()) a.status = v;
    if (!e.value("message").toString().isEmpty()) a.error = e.value("message").toString();
  }
  if (type == "file") {
    const QString f = e.value("path").toString();
    if (!f.isEmpty() && !a.files.contains(f)) a.files.push_back(f);
  }
  if (type == "done") {
    a.status = "done";
    if (!e.value("summary").toString().isEmpty()) a.summary = e.value("summary").toString();
    harvest(id);
    SandboxService::instance().deleteSandbox(id);
  }
  if (type == "error" && a.status != "done") {
    a.status = "error";
    a.error = e.value("message").toString(e.value("error").toString());
  }
  if (type == "screenshot") {
    QFile shot(DataStore::dataDir() + "/sandboxes/" + id + "/last-shot.txt");
    if (shot.open(QIODevice::WriteOnly | QIODevice::Truncate)) {
      shot.write(a.lastScreenshot.toUtf8());
      shot.close();
    }
  }
  agents_.insert(id, a);
  emit changed(id);
}

void AgentsService::harvest(const QString& id) {
  if (!agents_.contains(id)) return;
  auto& a = agents_[id];
  const QString localDir = QDir::tempPath() + "/omnia-agent-" + id + "-out";
  QDir().mkpath(localDir);
  if (!SandboxService::instance().copyOut(id, "/workspace/out/.", localDir)) return;
  QDir dir(localDir);
  int imported = 0;
  const auto entries = dir.entryInfoList(QDir::Files | QDir::Readable, QDir::Name);
  for (const QFileInfo& fi : entries) {
    if (imported >= 25) break;
    QFile f(fi.absoluteFilePath());
    if (!f.open(QIODevice::ReadOnly)) continue;
    const QByteArray data = f.readAll();
    f.close();
    const ArtifactMeta art = importArtifactFile(fi.fileName(), data, {});
    a.files.push_back(art.id);
    emit artifactImported(art);
    imported++;
  }
  QDir(localDir).removeRecursively();
}

}  // namespace omnia
