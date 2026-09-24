#include "datastore.h"

#include <QCoreApplication>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QRegularExpression>
#include <QSaveFile>
#include <QRandomGenerator>

namespace omnia {

qint64 nowMs() { return QDateTime::currentMSecsSinceEpoch(); }

QString newId(int len) {
  static const char* alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  QString out;
  out.reserve(len);
  for (int i = 0; i < len; ++i)
    out.append(QChar(alphabet[QRandomGenerator::global()->bounded(62)]));
  return out;
}

QString protocolToString(ProviderProtocol p) {
  switch (p) {
    case ProviderProtocol::Anthropic: return "anthropic";
    case ProviderProtocol::Gemini: return "gemini";
    default: return "openai";
  }
}

ProviderProtocol protocolFromString(const QString& s) {
  if (s == "anthropic") return ProviderProtocol::Anthropic;
  if (s == "gemini") return ProviderProtocol::Gemini;
  return ProviderProtocol::OpenAI;
}

QString DataStore::dataDir() {
  const QString env = qEnvironmentVariable("DATA_DIR");
  if (!env.isEmpty()) {
    QDir().mkpath(env);
    return env;
  }
  QString dir = QCoreApplication::applicationDirPath();
  for (int i = 0; i < 8 && !dir.isEmpty(); ++i) {
    if (QFile::exists(dir + "/package.json")) {
      const QString data = dir + "/data";
      QDir().mkpath(data);
      return data;
    }
    const QString parent = QDir(dir).absolutePath();
    dir = QFileInfo(parent).dir().absolutePath();
    if (dir == parent) break;
  }
  const QString fallback = QDir::currentPath() + "/data";
  QDir().mkpath(fallback);
  return fallback;
}

QString DataStore::filePath(const QString& name) { return dataDir() + "/" + name; }

QJsonValue DataStore::read(const QString& name, const QJsonValue& fallback) {
  QFile f(filePath(name));
  if (!f.open(QIODevice::ReadOnly)) return fallback;
  const QJsonDocument doc = QJsonDocument::fromJson(f.readAll());
  if (doc.isNull()) return fallback;
  return doc.isArray() ? QJsonValue(doc.array()) : QJsonValue(doc.object());
}

bool DataStore::write(const QString& name, const QJsonValue& value) {
  QDir().mkpath(QFileInfo(filePath(name)).absolutePath());
  QSaveFile f(filePath(name));
  if (!f.open(QIODevice::WriteOnly)) return false;
  const QJsonDocument doc = value.isArray() ? QJsonDocument(value.toArray()) : QJsonDocument(value.toObject());
  f.write(doc.toJson(QJsonDocument::Compact));
  return f.commit();
}

static Conversation conversationFromJson(const QJsonObject& o) {
  Conversation c;
  c.id = o.value("id").toString();
  c.title = o.value("title").toString();
  c.createdAt = qint64(o.value("createdAt").toDouble());
  c.updatedAt = qint64(o.value("updatedAt").toDouble());
  c.provider = o.value("provider").toString();
  c.model = o.value("model").toString();
  for (const QJsonValue& mv : o.value("messages").toArray()) {
    const QJsonObject mo = mv.toObject();
    ChatMessage m;
    m.id = mo.value("id").toString(newId());
    m.role = mo.value("role").toString("user");
    m.createdAt = qint64(mo.value("createdAt").toDouble(nowMs()));
    for (const QJsonValue& pv : mo.value("parts").toArray()) {
      const QJsonObject po = pv.toObject();
      MessagePart p;
      const QString t = po.value("type").toString("text");
      if (t == "text") {
        p.kind = MessagePart::Text;
        p.text.text = po.value("text").toString();
      } else if (t == "reasoning") {
        p.kind = MessagePart::Reasoning;
        p.reasoning.text = po.value("text").toString();
      } else if (t == "tool-call") {
        p.kind = MessagePart::ToolCall;
        p.toolCall.id = po.value("toolCallId").toString();
        p.toolCall.name = po.value("toolName").toString();
        p.toolCall.input = po.value("input").toObject();
      } else if (t == "tool-result") {
        p.kind = MessagePart::ToolResult;
        p.toolResult.toolCallId = po.value("toolCallId").toString();
        p.toolResult.toolName = po.value("toolName").toString();
        p.toolResult.output = po.value("output");
      } else if (t == "file") {
        p.kind = MessagePart::File;
        p.file.artifactId = po.value("artifactId").toString();
        p.file.name = po.value("name").toString();
        p.file.url = po.value("url").toString();
        p.file.type = po.value("fileType").toString();
        p.file.mime = po.value("mime").toString();
      } else if (t == "source") {
        p.kind = MessagePart::Source;
        p.source.n = int(po.value("n").toDouble());
        p.source.url = po.value("url").toString();
        p.source.title = po.value("title").toString();
      }
      m.parts.push_back(p);
    }
    c.messages.push_back(m);
  }
  return c;
}

static QJsonObject conversationToJson(const Conversation& c) {
  QJsonArray msgs;
  for (const ChatMessage& m : c.messages) {
    QJsonArray parts;
    for (const MessagePart& p : m.parts) {
      QJsonObject po;
      switch (p.kind) {
        case MessagePart::Text:
          po = {{"type", "text"}, {"text", p.text.text}};
          break;
        case MessagePart::Reasoning:
          po = {{"type", "reasoning"}, {"text", p.reasoning.text}};
          break;
        case MessagePart::ToolCall:
          po = {{"type", "tool-call"},
                {"toolCallId", p.toolCall.id},
                {"toolName", p.toolCall.name},
                {"input", p.toolCall.input}};
          break;
        case MessagePart::ToolResult:
          po = {{"type", "tool-result"},
                {"toolCallId", p.toolResult.toolCallId},
                {"toolName", p.toolResult.toolName},
                {"output", p.toolResult.output}};
          break;
        case MessagePart::File:
          po = {{"type", "file"},
                {"artifactId", p.file.artifactId},
                {"name", p.file.name},
                {"url", p.file.url},
                {"fileType", p.file.type},
                {"mime", p.file.mime}};
          break;
        case MessagePart::Source:
          po = {{"type", "source"}, {"n", p.source.n}, {"url", p.source.url}, {"title", p.source.title}};
          break;
      }
      parts.append(po);
    }
    msgs.append(QJsonObject{{"id", m.id},
                            {"role", m.role},
                            {"createdAt", double(m.createdAt)},
                            {"parts", parts}});
  }
  return QJsonObject{{"id", c.id},
                     {"title", c.title},
                     {"createdAt", double(c.createdAt)},
                     {"updatedAt", double(c.updatedAt)},
                     {"provider", c.provider},
                     {"model", c.model},
                     {"messages", msgs}};
}

QVector<Conversation> DataStore::listConversations() {
  QVector<Conversation> out;
  const QJsonArray arr = read("conversations.json", QJsonArray()).toArray();
  for (const QJsonValue& v : arr) out.push_back(conversationFromJson(v.toObject()));
  return out;
}

Conversation DataStore::getConversation(const QString& id) {
  for (const Conversation& c : listConversations())
    if (c.id == id) return c;
  return {};
}

bool DataStore::saveConversation(const Conversation& c) {
  QJsonArray arr = read("conversations.json", QJsonArray()).toArray();
  QJsonArray next;
  bool replaced = false;
  for (const QJsonValue& v : arr) {
    if (v.toObject().value("id").toString() == c.id) {
      next.append(conversationToJson(c));
      replaced = true;
    } else {
      next.append(v);
    }
  }
  if (!replaced) next.prepend(conversationToJson(c));
  while (next.size() > 200) next.removeLast();
  return write("conversations.json", next);
}

bool DataStore::deleteConversation(const QString& id) {
  QJsonArray arr = read("conversations.json", QJsonArray()).toArray();
  QJsonArray next;
  for (const QJsonValue& v : arr)
    if (v.toObject().value("id").toString() != id) next.append(v);
  return write("conversations.json", next);
}

void DataStore::clearConversations() { write("conversations.json", QJsonArray()); }

QMap<QString, QString> DataStore::providerKeys() {
  QMap<QString, QString> out;
  const QJsonObject o = read("provider-keys.json", QJsonObject()).toObject();
  for (auto it = o.begin(); it != o.end(); ++it) out.insert(it.key(), it.value().toString());
  return out;
}

void DataStore::setProviderKey(const QString& provider, const QString& key) {
  QJsonObject o = read("provider-keys.json", QJsonObject()).toObject();
  o.insert(provider, key);
  write("provider-keys.json", o);
}

void DataStore::deleteProviderKey(const QString& provider) {
  QJsonObject o = read("provider-keys.json", QJsonObject()).toObject();
  o.remove(provider);
  write("provider-keys.json", o);
}

QJsonObject DataStore::providerModelOverrides() {
  return read("provider-models.json", QJsonObject()).toObject();
}

void DataStore::saveProviderModelOverrides(const QJsonObject& o) {
  write("provider-models.json", o);
}

QVector<CustomProviderRecord> listCustomProviders() {
  QVector<CustomProviderRecord> out;
  for (const QJsonValue& v : DataStore::read("custom-providers.json", QJsonArray()).toArray()) {
    const QJsonObject o = v.toObject();
    CustomProviderRecord r;
    r.id = o.value("id").toString();
    r.name = o.value("name").toString();
    r.glyph = o.value("glyph").toString();
    r.baseUrl = o.value("baseUrl").toString();
    r.apiKey = o.value("apiKey").toString();
    r.apiKeyEnv = o.value("apiKeyEnv").toString();
    r.protocol = protocolFromString(o.value("protocol").toString("openai"));
    r.createdAt = qint64(o.value("createdAt").toDouble());
    r.updatedAt = qint64(o.value("updatedAt").toDouble());
    for (const QJsonValue& mv : o.value("models").toArray()) {
      if (mv.isString()) {
        CustomModelDef m;
        m.id = mv.toString();
        m.name = mv.toString();
        r.models.push_back(m);
      } else {
        const QJsonObject mo = mv.toObject();
        CustomModelDef m;
        m.id = mo.value("id").toString();
        m.name = mo.value("name").toString(m.id);
        m.supportsThinking = mo.value("supportsThinking").toBool();
        m.isDefault = mo.value("default").toBool();
        r.models.push_back(m);
      }
    }
    out.push_back(r);
  }
  return out;
}

void saveCustomProviders(const QVector<CustomProviderRecord>& list) {
  QJsonArray arr;
  for (const CustomProviderRecord& r : list) {
    QJsonArray models;
    for (const CustomModelDef& m : r.models)
      models.append(QJsonObject{{"id", m.id},
                                {"name", m.name},
                                {"supportsThinking", m.supportsThinking},
                                {"default", m.isDefault}});
    arr.append(QJsonObject{{"id", r.id},
                           {"name", r.name},
                           {"glyph", r.glyph},
                           {"baseUrl", r.baseUrl},
                           {"apiKey", r.apiKey},
                           {"apiKeyEnv", r.apiKeyEnv},
                           {"protocol", protocolToString(r.protocol)},
                           {"models", models},
                           {"createdAt", double(r.createdAt)},
                           {"updatedAt", double(r.updatedAt)}});
  }
  DataStore::write("custom-providers.json", arr);
}

QString uniqueProviderId(const QString& name) {
  QString base = name.toLower();
  base.replace(QRegularExpression("[^a-z0-9]+"), "-");
  base = base.mid(0, 32);
  if (base.isEmpty()) base = "provider";
  QString id = base;
  int n = 1;
  const auto existing = listCustomProviders();
  auto taken = [&](const QString& x) {
    for (const auto& r : existing)
      if (r.id == x) return true;
    return false;
  };
  while (taken(id)) id = base + "-" + QString::number(++n);
  return id;
}

QVector<SearchProviderDef> listSearchProviders() {
  QVector<SearchProviderDef> out;
  for (const QJsonValue& v : DataStore::read("search-providers.json", QJsonArray()).toArray()) {
    const QJsonObject o = v.toObject();
    SearchProviderDef d;
    d.id = o.value("id").toString();
    d.name = o.value("name").toString();
    d.kind = o.value("kind").toString();
    d.apiKey = o.value("apiKey").toString();
    d.apiKeyEnv = o.value("apiKeyEnv").toString();
    d.baseUrl = o.value("baseUrl").toString();
    d.maxResults = int(o.value("maxResults").toDouble(8));
    d.enabled = o.value("enabled").toBool(true);
    d.createdAt = qint64(o.value("createdAt").toDouble());
    d.updatedAt = qint64(o.value("updatedAt").toDouble());
    out.push_back(d);
  }
  return out;
}

void saveSearchProviders(const QVector<SearchProviderDef>& list) {
  QJsonArray arr;
  for (const SearchProviderDef& d : list)
    arr.append(QJsonObject{{"id", d.id},
                           {"name", d.name},
                           {"kind", d.kind},
                           {"apiKey", d.apiKey},
                           {"apiKeyEnv", d.apiKeyEnv},
                           {"baseUrl", d.baseUrl},
                           {"maxResults", d.maxResults},
                           {"enabled", d.enabled},
                           {"createdAt", double(d.createdAt)},
                           {"updatedAt", double(d.updatedAt)}});
  DataStore::write("search-providers.json", arr);
}

QVector<SearchProviderDef> listEnabledSearchProviders() {
  QVector<SearchProviderDef> out;
  for (const auto& d : listSearchProviders())
    if (d.enabled) out.push_back(d);
  return out;
}

QVector<SkillDef> listSkills() {
  QVector<SkillDef> out;
  for (const QJsonValue& v : DataStore::read("skills.json", QJsonArray()).toArray()) {
    const QJsonObject o = v.toObject();
    SkillDef s;
    s.id = o.value("id").toString();
    s.name = o.value("name").toString();
    s.description = o.value("description").toString();
    s.prompt = o.value("prompt").toString();
    s.source = o.value("source").toString();
    s.enabled = o.value("enabled").toBool(true);
    s.updatedAt = qint64(o.value("updatedAt").toDouble());
    out.push_back(s);
  }
  return out;
}

void saveSkills(const QVector<SkillDef>& list) {
  QJsonArray arr;
  for (const SkillDef& s : list)
    arr.append(QJsonObject{{"id", s.id},
                           {"name", s.name},
                           {"description", s.description},
                           {"prompt", s.prompt},
                           {"source", s.source},
                           {"enabled", s.enabled},
                           {"updatedAt", double(s.updatedAt)}});
  DataStore::write("skills.json", arr);
}

QString skillsPromptBlock() {
  QString out;
  for (const SkillDef& s : listSkills()) {
    if (!s.enabled) continue;
    out += "## Skill: " + s.name + "\n" + s.description + "\n";
    if (!s.prompt.isEmpty()) out += s.prompt + "\n";
    out += "\n";
  }
  return out;
}

QVector<MCPServerDef> listMcpServers() {
  QVector<MCPServerDef> out;
  for (const QJsonValue& v : DataStore::read("mcp-servers.json", QJsonArray()).toArray()) {
    const QJsonObject o = v.toObject();
    MCPServerDef d;
    d.id = o.value("id").toString();
    d.name = o.value("name").toString();
    d.enabled = o.value("enabled").toBool(true);
    d.type = o.value("type").toString("stdio");
    d.command = o.value("command").toString();
    d.args = jsonStringList(o.value("args"));
    d.url = o.value("url").toString();
    const QJsonObject env = o.value("env").toObject();
    for (auto it = env.begin(); it != env.end(); ++it) d.env.insert(it.key(), it.value().toString());
    out.push_back(d);
  }
  return out;
}

void saveMcpServers(const QVector<MCPServerDef>& list) {
  QJsonArray arr;
  for (const MCPServerDef& d : list) {
    QJsonObject env;
    for (auto it = d.env.begin(); it != d.env.end(); ++it) env.insert(it.key(), it.value());
    arr.append(QJsonObject{{"id", d.id},
                           {"name", d.name},
                           {"enabled", d.enabled},
                           {"type", d.type},
                           {"command", d.command},
                           {"args", stringArray(d.args)},
                           {"url", d.url},
                           {"env", env}});
  }
  DataStore::write("mcp-servers.json", arr);
}

}  // namespace omnia
