#pragma once

#include "datastore.h"

namespace omnia {

const QVector<ProviderConfig>& builtinProviders();
bool isBuiltinProvider(const QString& id);
ProviderConfig findProvider(const QString& id);
QVector<ProviderConfig> allProviders();
QString getDefaultModel(const QString& provider);
ModelConfig findModel(const QString& provider, const QString& model);
bool modelSupportsThinking(const QString& provider, const QString& model);
QString resolveApiKey(const QString& provider);
QString keySource(const QString& provider);
QString resolveBaseUrl(const QString& provider);
QString modelLabel(const QString& provider, const QString& model);
QString providerGlyph(const QString& provider);
QVector<ModelConfig> effectiveModels(const QString& provider);
void setLiveModelIds(const QString& provider, const QStringList& ids);
QStringList liveModelIds(const QString& provider);
void addProviderModel(const QString& provider, const ModelConfig& m);
void renameProviderModel(const QString& provider, const QString& oldId, const ModelConfig& m);
void deleteProviderModel(const QString& provider, const QString& id, bool unhide = false);

struct LiveModelsOutcome {
  QVector<QString> ids;
  bool ok = false;
  QString error;
};
LiveModelsOutcome fetchLiveModels(const QString& provider);

}  // namespace omnia
