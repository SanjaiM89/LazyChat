#pragma once

#include <QObject>

#include "types.h"

namespace omnia {

class AgentsService : public QObject {
  Q_OBJECT
 public:
  static AgentsService& instance();
  QVector<AgentMeta> list();
  AgentMeta get(const QString& id);
  AgentMeta spawn(const QString& task, const QString& provider, const QString& model,
                  const QString& engine, const QString& label, bool research);
  bool stop(const QString& id);
  void cleanupFinished(qint64 maxAgeMs = 4LL * 60 * 60 * 1000);

 signals:
  void changed(const QString& id);
  void artifactImported(const ArtifactMeta& artifact);

 private:
  AgentsService();
  void onEvent(const QString& id, const QJsonObject& e);
  void harvest(const QString& id);
  QHash<QString, AgentMeta> agents_;
};

QString agentRunnerCommand(const QString& agentId, const QString& provider, const QString& model,
                           const QString& engine);

}  // namespace omnia
