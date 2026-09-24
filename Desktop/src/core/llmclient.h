#pragma once

#include <atomic>
#include <functional>

#include "types.h"

namespace omnia {

struct LlmToolSpec {
  QString name;
  QString description;
  QJsonObject parameters;
};

struct ChatRequest {
  QString provider;
  QString model;
  QString system;
  QVector<ChatMessage> messages;
  QVector<LlmToolSpec> tools;
  double temperature = 0.7;
  bool thinking = true;
  int maxTokens = 8192;
};

struct LlmResponse {
  QString text;
  QString reasoning;
  QVector<ToolCallPart> toolCalls;
  QString error;
  bool failed() const { return !error.isEmpty(); }
};

using TextSink = std::function<void(const QString&)>;
using Checkpoint = std::function<bool()>;  // return true to abort

QString providerErrorMessage(const QString& provider, const QString& raw, int status);

LlmResponse streamCompletion(const ChatRequest& req, TextSink onText, TextSink onReasoning,
                             std::atomic<bool>* abort);

}  // namespace omnia
