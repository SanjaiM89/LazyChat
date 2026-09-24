#include "chatengine.h"

#include <QRegularExpression>

#include "artifacts.h"
#include "datastore.h"
#include "systemprompt.h"
#include "tools.h"

namespace omnia {

class EngineThread : public QThread {
 public:
  explicit EngineThread(ChatEngine* engine) : engine_(engine) {}
 protected:
  void run() override { engine_->executeRun(); }

 private:
  ChatEngine* engine_;
};

QString deriveTitle(const QVector<ChatMessage>& messages) {
  for (const ChatMessage& m : messages) {
    if (m.role != "user") continue;
    bool skip = false;
    for (const MessagePart& p : m.parts)
      if (p.kind == MessagePart::Text && p.text.text.startsWith("[subchat-context]")) skip = true;
    if (skip) continue;
    QString t = m.plainText().trimmed();
    t.replace(QRegularExpression("\\s+"), " ");
    if (t.isEmpty()) continue;
    return t.left(80);
  }
  return "New chat";
}

ChatEngine::ChatEngine(QObject* parent) : QObject(parent) {}

ChatEngine::~ChatEngine() {
  stop();
  if (thread_) {
    thread_->quit();
    thread_->wait(4000);
  }
}

ChatRunSummary ChatEngine::summary() const {
  ChatRunSummary s;
  s.id = runId_;
  s.conversationId = conversationId_;
  s.status = active_ ? "working" : "done";
  s.startedAt = startedAt_;
  s.updatedAt = nowMs();
  return s;
}

bool ChatEngine::start(const QVector<ChatMessage>& messages, const ChatSettings& settings,
                       const QString& conversationId) {
  if (active_) return false;
  messages_ = messages;
  settings_ = settings;
  conversationId_ = conversationId;
  runId_ = newId(10);
  startedAt_ = nowMs();
  abort_.store(false);
  active_.store(true);

  for (auto& m : messages_) {
    for (auto& p : m.parts) {
      if (p.kind == MessagePart::File && p.file.data.isEmpty() && !p.file.artifactId.isEmpty()) {
        const ArtifactMeta a = getArtifact(p.file.artifactId);
        if (!a.id.isEmpty()) p.file.data = readArtifactBuffer(a);
      }
    }
  }

  auto* t = new EngineThread(this);
  t->setObjectName("chat-run-" + runId_);
  thread_ = t;
  t->start();
  emit statusChanged("working", "Thinking…");
  return true;
}

void ChatEngine::stop() { abort_.store(true); }

void ChatEngine::executeRun() {
  const QVector<LlmToolSpec> toolSpecs = buildToolSpecs(settings_);
  const QString system = buildSystemPrompt(settings_.provider, settings_.model);

  auto finish = [&](bool ok, const QString& status, const QString& detail) {
    active_.store(false);
    emit snapshot(messages_, conversationId_);
    emit statusChanged(status, detail);
    emit finished(ok, detail);
    if (thread_) thread_->quit();
  };

  for (int step = 0; step < settings_.maxSteps; ++step) {
    if (abort_.load()) {
      finish(false, "stopped", "Stopped");
      return;
    }

    ChatMessage assistant;
    assistant.id = "msg_" + newId(10);
    assistant.role = "assistant";
    assistant.createdAt = nowMs();
    QString text;
    QString reasoning;

    ChatRequest req;
    req.provider = settings_.provider;
    req.model = settings_.model;
    req.system = system;
    req.messages = messages_;
    req.tools = toolSpecs;
    req.temperature = settings_.temperature;
    req.thinking = settings_.thinking;

    emit statusChanged("working", "Working…");

    const LlmResponse resp = streamCompletion(
        req,
        [&](const QString& d) {
          text += d;
          emit textDelta(d);
        },
        [&](const QString& d) {
          reasoning += d;
          emit reasoningDelta(d);
        },
        &abort_);

    if (resp.failed()) {
      finish(false, abort_.load() ? "stopped" : "error",
             abort_.load() ? QStringLiteral("Stopped") : resp.error);
      return;
    }

    if (!reasoning.isEmpty()) {
      MessagePart p;
      p.kind = MessagePart::Reasoning;
      p.reasoning.text = reasoning;
      assistant.parts.push_back(p);
    }
    if (!text.isEmpty()) {
      MessagePart p;
      p.kind = MessagePart::Text;
      p.text.text = text;
      assistant.parts.push_back(p);
    }

    if (resp.toolCalls.isEmpty()) {
      messages_.push_back(assistant);
      emit assistantMessageReady(assistant);
      finish(true, "done", "Done");
      return;
    }

    for (const ToolCallPart& tc : resp.toolCalls) {
      MessagePart p;
      p.kind = MessagePart::ToolCall;
      p.toolCall = tc;
      assistant.parts.push_back(p);
    }
    messages_.push_back(assistant);
    emit assistantMessageReady(assistant);

    ChatMessage results;
    results.id = "msg_" + newId(10);
    results.role = "tool";
    results.createdAt = nowMs();

    bool anyTool = false;
    for (const ToolCallPart& tc : resp.toolCalls) {
      if (abort_.load()) break;
      emit toolStarted(tc.id, tc.name, tc.input);
      emit statusChanged("working", tc.name);
      const QJsonValue out = executeTool(tc.name, tc.input, settings_, &abort_);
      emit toolFinished(tc.id, tc.name, out);
      MessagePart p;
      p.kind = MessagePart::ToolResult;
      p.toolResult.toolCallId = tc.id;
      p.toolResult.toolName = tc.name;
      p.toolResult.output = out;
      results.parts.push_back(p);
      anyTool = true;
    }
    if (!anyTool) {
      finish(false, "stopped", "Stopped");
      return;
    }
    messages_.push_back(results);
    emit snapshot(messages_, conversationId_);
  }

  finish(false, "error", "Reached max steps (" + QString::number(settings_.maxSteps) + ")");
}

}  // namespace omnia
