#pragma once

#include <QObject>
#include <QThread>
#include <atomic>

#include "llmclient.h"
#include "types.h"

namespace omnia {

class ChatEngine : public QObject {
  Q_OBJECT
 public:
  explicit ChatEngine(QObject* parent = nullptr);
  ~ChatEngine() override;

  bool isActive() const { return active_; }
  QString activeConversationId() const { return conversationId_; }
  QString runId() const { return runId_; }
  ChatRunSummary summary() const;

  bool start(const QVector<ChatMessage>& messages, const ChatSettings& settings,
             const QString& conversationId);
  void stop();

 signals:
  void textDelta(const QString& delta);
  void reasoningDelta(const QString& delta);
  void toolStarted(const QString& callId, const QString& name, const QJsonObject& input);
  void toolFinished(const QString& callId, const QString& name, const QJsonValue& output);
  void assistantMessageReady(const ChatMessage& message);
  void statusChanged(const QString& status, const QString& detail);
  void snapshot(const QVector<ChatMessage>& messages, const QString& conversationId);
  void finished(bool ok, const QString& error);

 private:
  friend class EngineThread;
  void executeRun();
  ChatMessage emptyAssistant() const;

  QVector<ChatMessage> messages_;
  ChatSettings settings_;
  QString conversationId_;
  QString runId_;
  qint64 startedAt_ = 0;
  std::atomic<bool> abort_{false};
  std::atomic<bool> active_{false};
  QThread* thread_ = nullptr;
};

QString deriveTitle(const QVector<ChatMessage>& messages);

}  // namespace omnia
