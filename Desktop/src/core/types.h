#pragma once

#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QString>
#include <QStringList>
#include <QVector>
#include <QDateTime>

namespace omnia {

inline QJsonArray stringArray(const QStringList& list) {
  QJsonArray a;
  for (const QString& s : list) a.append(s);
  return a;
}

inline QStringList jsonStringList(const QJsonValue& v) {
  QStringList out;
  if (v.isArray())
    for (const QJsonValue& x : v.toArray()) out << x.toString();
  return out;
}

enum class Theme { System, Light, Dark };
enum class Panel { None, Artifacts, Sandbox, Agents };
enum class ProviderProtocol { OpenAI, Anthropic, Gemini };
enum class Control { Model, User };
enum class RunStatus { Idle, Working, Stopping, Error };

struct ModelConfig {
  QString id;
  QString name;
  bool supportsThinking = false;
  bool supportsVision = false;
  int context = 128000;
  int maxOutput = 8192;
  QString category = "fast";
  bool isDefault = false;
  QString transport;
  bool liveOnly = false;
};

struct ProviderConfig {
  QString id;
  QString name;
  QString tagline;
  QString glyph;
  QString keyEnv;
  bool requiresKey = true;
  QString baseUrlEnv;
  QString defaultBaseUrl;
  QString providerOptionsKey;
  QVector<ModelConfig> models;
  bool isCustom = false;
  ProviderProtocol protocol = ProviderProtocol::OpenAI;
  QString apiKey;
  QString apiKeyEnv;
};

struct CustomModelDef {
  QString id;
  QString name;
  bool supportsThinking = false;
  bool isDefault = false;
};

struct SearchProviderDef {
  QString id;
  QString name;
  QString kind;
  QString apiKey;
  QString apiKeyEnv;
  QString baseUrl;
  int maxResults = 8;
  bool enabled = true;
  qint64 createdAt = 0;
  qint64 updatedAt = 0;
};

struct SkillDef {
  QString id;
  QString name;
  QString description;
  QString prompt;
  QString source;
  bool enabled = true;
  qint64 updatedAt = 0;
};

struct MCPServerDef {
  QString id;
  QString name;
  bool enabled = true;
  QString type;
  QString command;
  QStringList args;
  QString url;
  QMap<QString, QString> env;
};

struct MCPToolInfo {
  QString server;
  QString name;
  QString description;
  QJsonObject inputSchema;
};

struct ArtifactMeta {
  QString id;
  QString type;
  QString title;
  QString language;
  QString conversationId;
  QString url;
  QString filename;
  QString mime;
  qint64 createdAt = 0;
  qint64 updatedAt = 0;
  QString content;
};

struct SearchResult {
  int position = 0;
  QString title;
  QString url;
  QString hostname;
  QString description;
};

struct FilePart {
  QString artifactId;
  QString name;
  QString url;
  QString type;
  QString mime;
  QByteArray data;
};

struct TextPart {
  QString text;
};

struct ReasoningPart {
  QString text;
};

struct ToolCallPart {
  QString id;
  QString name;
  QJsonObject input;
};

struct ToolResultPart {
  QString toolCallId;
  QString toolName;
  QJsonValue output;
};

struct SourcePart {
  int n = 0;
  QString url;
  QString title;
};

struct MessagePart {
  enum Kind { Text, Reasoning, ToolCall, ToolResult, File, Source } kind = Text;
  TextPart text;
  ReasoningPart reasoning;
  ToolCallPart toolCall;
  ToolResultPart toolResult;
  FilePart file;
  SourcePart source;
};

struct ChatMessage {
  QString id;
  QString role;
  QVector<MessagePart> parts;
  qint64 createdAt = 0;

  QString plainText() const {
    QString out;
    for (const MessagePart& p : parts)
      if (p.kind == MessagePart::Text) out += p.text.text;
    return out;
  }
};

struct Conversation {
  QString id;
  QString title;
  qint64 createdAt = 0;
  qint64 updatedAt = 0;
  QString provider;
  QString model;
  QVector<ChatMessage> messages;
};

struct ChatSettings {
  QString provider = "anthropic";
  QString model = "claude-sonnet-5";
  bool thinking = true;
  double temperature = 0.7;
  int maxSteps = 14;
  QStringList tools = {"webSearch", "createArtifact", "runAgentTask", "computerUse"};

  QJsonObject toJson() const {
    return QJsonObject{{"provider", provider},
                       {"model", model},
                       {"thinking", thinking},
                       {"temperature", temperature},
                       {"maxSteps", maxSteps},
                       {"tools", stringArray(tools)}};
  }
  static ChatSettings fromJson(const QJsonObject& o) {
    ChatSettings s;
    s.provider = o.value("provider").toString(s.provider);
    s.model = o.value("model").toString(s.model);
    s.thinking = o.value("thinking").toBool(s.thinking);
    s.temperature = o.value("temperature").toDouble(s.temperature);
    s.maxSteps = int(o.value("maxSteps").toDouble(s.maxSteps));
    if (o.contains("tools")) s.tools = jsonStringList(o.value("tools"));
    return s;
  }
};

struct DisplaySettings {
  QString font = "system";
  int fontSize = 15;
  int contentWidth = 780;
};

struct SandboxMeta {
  QString id;
  QString label;
  QString status;
  QString image;
  qint64 createdAt = 0;
  QString lastScreenshot;
};

struct AgentMeta {
  QString id;
  QString task;
  QString label;
  QString provider;
  QString model;
  QString engine;
  QString status;
  bool research = false;
  qint64 createdAt = 0;
  qint64 updatedAt = 0;
  QVector<QJsonObject> logs;
  QStringList files;
  QString lastScreenshot;
  QString summary;
  QString error;
};

struct ChromiumStep {
  int i = 0;
  qint64 t = 0;
  QString actor;
  QString action;
  QString detail;
  QString url;
  QString title;
  QString shot;
};

struct ChromiumTimeline {
  Control control = Control::Model;
  qint64 controlAt = 0;
  QVector<ChromiumStep> steps;
};

struct ChromiumResult {
  QString url;
  QString title;
  QString text;
  QString image;
  bool ok = true;
  QString error;
};

struct ChromiumSearchOutcome {
  QString engine;
  QString query;
  QVector<SearchResult> results;
  QString image;
};

struct ChatRunSummary {
  QString id;
  QString conversationId;
  QString status;
  qint64 startedAt = 0;
  qint64 updatedAt = 0;
};

}  // namespace omnia
