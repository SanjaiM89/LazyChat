#pragma once

#include "llmclient.h"
#include "types.h"

namespace omnia {

QVector<LlmToolSpec> buildToolSpecs(const ChatSettings& settings);
QJsonValue executeTool(const QString& name, const QJsonObject& args, const ChatSettings& settings,
                       std::atomic<bool>* abort = nullptr);
QString computerSystemNote();

}  // namespace omnia
