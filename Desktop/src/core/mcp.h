#pragma once

#include <QObject>
#include <QProcess>

#include "types.h"

namespace omnia {

class McpConnection : public QObject {
  Q_OBJECT
 public:
  explicit McpConnection(const MCPServerDef& def, QObject* parent = nullptr);
  ~McpConnection() override;
  bool connectToServer(int timeoutMs = 8000);
  void disconnectFromServer();
  bool isConnected() const { return connected_; }
  QVector<MCPToolInfo> tools() const { return tools_; }
  QJsonValue callTool(const QString& name, const QJsonObject& args);

 signals:
  void statusChanged(const QString& status);

 private:
  QJsonValue rpc(const QString& method, const QJsonValue& params, int timeoutMs = 15000);
  MCPServerDef def_;
  QProcess* proc_ = nullptr;
  int nextId_ = 1;
  bool connected_ = false;
  QVector<MCPToolInfo> tools_;
};

class McpRegistry : public QObject {
  Q_OBJECT
 public:
  static McpRegistry& instance();
  QVector<MCPServerDef> servers() const;
  void saveServers(const QVector<MCPServerDef>& servers);
  bool addServer(const MCPServerDef& def);
  bool removeServer(const QString& id);
  bool setEnabled(const QString& id, bool enabled);
  void reconnectAll();
  QVector<MCPToolInfo> allTools();

 signals:
  void changed();

 private:
  McpRegistry();
  QHash<QString, McpConnection*> conns_;
};

}  // namespace omnia
