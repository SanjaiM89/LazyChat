#pragma once

#include <QObject>
#include <QTcpServer>

#include "types.h"

namespace omnia {

struct SandboxHealth {
  bool ok = false;
  bool docker = false;
  QString version;
  QStringList images;
  int activeContainers = 0;
};

class SandboxService : public QObject {
  Q_OBJECT
 public:
  static SandboxService& instance();
  SandboxHealth health();
  SandboxMeta createSandbox(const QString& label, const QMap<QString, QString>& env,
                            const QString& runnerCommand = {});
  QVector<SandboxMeta> listSandboxes();
  bool startSandbox(const QString& id);
  bool killSandbox(const QString& id);
  bool deleteSandbox(const QString& id);
  struct ExecResult {
    QString output;
    QString stderrText;
    int exitCode = 0;
  };
  ExecResult exec(const QString& id, const QString& command, int timeoutMs = 120000);
  bool writeFile(const QString& id, const QString& path, const QByteArray& content);
  QByteArray readFile(const QString& id, const QString& path);
  QJsonArray listFiles(const QString& id, const QString& path = "/workspace");
  bool copyOut(const QString& id, const QString& remotePath, const QString& localPath);
  QString receiverUrl() const;

 signals:
  void agentEvent(const QString& agentId, const QJsonObject& event);

 private:
  SandboxService();
  QString containerName(const QString& id) const;
  QMap<QString, QString> filteredEnv(const QMap<QString, QString>& env) const;
  QTcpServer* server_ = nullptr;
  quint16 port_ = 0;
};

QString docker(const QStringList& args, int timeoutMs = 30000, int* exitCode = nullptr);

}  // namespace omnia
