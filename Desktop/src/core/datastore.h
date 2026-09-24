#pragma once

#include "types.h"

namespace omnia {

struct CustomProviderRecord {
  QString id;
  QString name;
  QString glyph;
  QString baseUrl;
  QString apiKey;
  QString apiKeyEnv;
  ProviderProtocol protocol = ProviderProtocol::OpenAI;
  QVector<CustomModelDef> models;
  qint64 createdAt = 0;
  qint64 updatedAt = 0;
};

class DataStore {
 public:
  static QString dataDir();
  static QString filePath(const QString& name);
  static QJsonValue read(const QString& name, const QJsonValue& fallback = QJsonValue());
  static bool write(const QString& name, const QJsonValue& value);

  static QVector<Conversation> listConversations();
  static Conversation getConversation(const QString& id);
  static bool saveConversation(const Conversation& c);
  static bool deleteConversation(const QString& id);
  static void clearConversations();

  static QMap<QString, QString> providerKeys();
  static void setProviderKey(const QString& provider, const QString& key);
  static void deleteProviderKey(const QString& provider);

  static QJsonObject providerModelOverrides();
  static void saveProviderModelOverrides(const QJsonObject& o);
};

qint64 nowMs();
QString newId(int len = 12);
QString protocolToString(ProviderProtocol p);
ProviderProtocol protocolFromString(const QString& s);

QVector<CustomProviderRecord> listCustomProviders();
void saveCustomProviders(const QVector<CustomProviderRecord>& list);
QString uniqueProviderId(const QString& name);

QVector<SearchProviderDef> listSearchProviders();
void saveSearchProviders(const QVector<SearchProviderDef>& list);
QVector<SearchProviderDef> listEnabledSearchProviders();

QVector<SkillDef> listSkills();
void saveSkills(const QVector<SkillDef>& list);
QString skillsPromptBlock();

QVector<MCPServerDef> listMcpServers();
void saveMcpServers(const QVector<MCPServerDef>& list);

}  // namespace omnia
