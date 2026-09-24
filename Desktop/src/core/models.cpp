#include "models.h"

#include <QEventLoop>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QRegularExpression>
#include <QSet>
#include <QSettings>

namespace omnia {

static ModelConfig M(const QString& id, const QString& name, bool thinking = false, bool vision = false,
                     int ctx = 128000, int out = 8192, const QString& cat = "fast", bool def = false) {
  ModelConfig m;
  m.id = id;
  m.name = name;
  m.supportsThinking = thinking;
  m.supportsVision = vision;
  m.context = ctx;
  m.maxOutput = out;
  m.category = cat;
  m.isDefault = def;
  return m;
}

const QVector<ProviderConfig>& builtinProviders() {
  static const QVector<ProviderConfig> providers = [] {
    QVector<ProviderConfig> v;

    ProviderConfig anthropic;
    anthropic.id = "anthropic";
    anthropic.name = "Anthropic";
    anthropic.tagline = "Claude models";
    anthropic.glyph = "A";
    anthropic.keyEnv = "ANTHROPIC_API_KEY";
    anthropic.requiresKey = true;
    anthropic.defaultBaseUrl = "https://api.anthropic.com";
    anthropic.models = {
        M("claude-sonnet-5", "Claude Sonnet 5", true, true, 200000, 64000, "reasoning", true),
        M("claude-opus-5", "Claude Opus 5", true, true, 200000, 64000, "reasoning"),
        M("claude-haiku-4-5-20251001", "Claude Haiku 4.5", false, true, 200000, 64000, "fast"),
    };
    v.push_back(anthropic);

    ProviderConfig openai;
    openai.id = "openai";
    openai.name = "OpenAI";
    openai.tagline = "GPT models";
    openai.glyph = "O";
    openai.keyEnv = "OPENAI_API_KEY";
    openai.requiresKey = true;
    openai.baseUrlEnv = "OPENAI_BASE_URL";
    openai.defaultBaseUrl = "https://api.openai.com/v1";
    openai.models = {
        M("gpt-5", "GPT-5", true, true, 400000, 128000, "reasoning", true),
        M("gpt-5-mini", "GPT-5 mini", true, true, 400000, 128000, "fast"),
        M("o4-mini", "o4-mini", true, true, 200000, 100000, "reasoning"),
        M("gpt-4.1", "GPT-4.1", false, true, 1047576, 32768, "fast"),
    };
    v.push_back(openai);

    ProviderConfig google;
    google.id = "google";
    google.name = "Google";
    google.tagline = "Gemini models";
    google.glyph = "G";
    google.keyEnv = "GOOGLE_GENERATIVE_AI_API_KEY";
    google.requiresKey = true;
    google.baseUrlEnv = "GOOGLE_GENERATIVE_AI_BASE_URL";
    google.defaultBaseUrl = "https://generativelanguage.googleapis.com/v1beta";
    google.models = {
        M("gemini-2.5-pro", "Gemini 2.5 Pro", true, true, 1048576, 65536, "reasoning", true),
        M("gemini-2.5-flash", "Gemini 2.5 Flash", true, true, 1048576, 65536, "fast"),
        M("gemini-2.0-flash", "Gemini 2.0 Flash", false, true, 1048576, 8192, "fast"),
    };
    v.push_back(google);

    ProviderConfig ollama;
    ollama.id = "ollama";
    ollama.name = "Ollama";
    ollama.tagline = "Local models";
    ollama.glyph = "OL";
    ollama.requiresKey = false;
    ollama.baseUrlEnv = "OLLAMA_BASE_URL";
    ollama.defaultBaseUrl = "http://127.0.0.1:11434/v1";
    ollama.models = {
        M("llama3.2", "Llama 3.2", false, false, 131072, 8192, "fast", true),
        M("qwen3:8b", "Qwen3 8B", true, false, 40960, 8192, "reasoning"),
        M("deepseek-r1:14b", "DeepSeek R1 14B", true, false, 65536, 8192, "reasoning"),
    };
    v.push_back(ollama);

    ProviderConfig lmstudio;
    lmstudio.id = "lmstudio";
    lmstudio.name = "LM Studio";
    lmstudio.tagline = "Local models";
    lmstudio.glyph = "LM";
    lmstudio.requiresKey = false;
    lmstudio.baseUrlEnv = "LMSTUDIO_BASE_URL";
    lmstudio.defaultBaseUrl = "http://127.0.0.1:1234/v1";
    lmstudio.models = {M("local-model", "Local model", false, false, 32768, 8192, "fast", true)};
    v.push_back(lmstudio);

    ProviderConfig opencode;
    opencode.id = "opencode";
    opencode.name = "OpenCode";
    opencode.tagline = "Zen multi-model gateway";
    opencode.glyph = "OC";
    opencode.keyEnv = "OPENCODE_API_KEY";
    opencode.requiresKey = true;
    opencode.baseUrlEnv = "OPENCODE_BASE_URL";
    opencode.defaultBaseUrl = "https://opencode.ai/zen/v1";
    opencode.models = {
        M("muse-spark-1.3-contributor-free", "Muse Spark 1.3", false, true, 200000, 64000, "fast", true),
        M("gpt-5.5", "GPT-5.5", true, true, 400000, 128000, "reasoning"),
        M("gpt-5.4-mini", "GPT-5.4 mini", true, true, 400000, 128000, "fast"),
        M("muse-spark-1.3", "Muse Spark 1.3", false, true, 200000, 64000, "fast"),
        M("grok-4.5", "Grok 4.5", true, true, 256000, 64000, "reasoning"),
        M("claude-sonnet-5", "Claude Sonnet 5", true, true, 200000, 64000, "reasoning"),
        M("claude-opus-5", "Claude Opus 5", true, true, 200000, 64000, "reasoning"),
        M("claude-haiku-4-5", "Claude Haiku 4.5", false, true, 200000, 64000, "fast"),
        M("gemini-3-flash", "Gemini 3 Flash", true, true, 1048576, 65536, "fast"),
        M("gemini-3.1-pro", "Gemini 3.1 Pro", true, true, 1048576, 65536, "reasoning"),
        M("kimi-k2.6", "Kimi K2.6", false, true, 256000, 64000, "fast"),
        M("deepseek-v4-flash", "DeepSeek V4 Flash", false, true, 163840, 32768, "fast"),
        M("glm-5.2", "GLM 5.2", true, true, 200000, 32768, "reasoning"),
        M("big-pickle", "Big Pickle", false, false, 131072, 16384, "creative"),
    };
    v.push_back(opencode);

    return v;
  }();
  return providers;
}

bool isBuiltinProvider(const QString& id) {
  for (const auto& p : builtinProviders())
    if (p.id == id) return true;
  return false;
}

ProviderConfig findProvider(const QString& id) {
  for (const auto& p : builtinProviders())
    if (p.id == id) return p;
  for (const auto& r : listCustomProviders())
    if (r.id == id) {
      ProviderConfig p;
      p.id = r.id;
      p.name = r.name;
      p.glyph = r.glyph.isEmpty() ? r.name.left(2).toUpper() : r.glyph;
      p.tagline = protocolToString(r.protocol) + QStringLiteral(" compatible");
      p.requiresKey = !(r.apiKey.isEmpty() && r.apiKeyEnv.isEmpty());
      p.defaultBaseUrl = r.baseUrl;
      p.isCustom = true;
      p.protocol = r.protocol;
      p.apiKey = r.apiKey;
      p.apiKeyEnv = r.apiKeyEnv;
      for (const auto& m : r.models)
        p.models.push_back(M(m.id, m.name.isEmpty() ? m.id : m.name, m.supportsThinking, false, 128000, 8192,
                             "fast", m.isDefault));
      return p;
    }
  return {};
}

QVector<ProviderConfig> allProviders() {
  QVector<ProviderConfig> out = builtinProviders();
  for (const auto& r : listCustomProviders()) out.push_back(findProvider(r.id));
  return out;
}

QString getDefaultModel(const QString& provider) {
  const ProviderConfig p = findProvider(provider);
  for (const auto& m : p.models)
    if (m.isDefault) return m.id;
  return p.models.isEmpty() ? QString() : p.models.first().id;
}

ModelConfig findModel(const QString& provider, const QString& model) {
  for (const auto& m : effectiveModels(provider))
    if (m.id == model) return m;
  return {};
}

bool modelSupportsThinking(const QString& provider, const QString& model) {
  return findModel(provider, model).supportsThinking;
}

QString resolveApiKey(const QString& provider) {
  const auto stored = DataStore::providerKeys();
  if (stored.contains(provider) && !stored.value(provider).isEmpty()) return stored.value(provider);
  const ProviderConfig p = findProvider(provider);
  if (!p.keyEnv.isEmpty()) {
    const QString env = qEnvironmentVariable(p.keyEnv.toUtf8().constData());
    if (!env.isEmpty()) return env;
  }
  if (p.isCustom && !p.apiKey.isEmpty()) return p.apiKey;
  if (p.isCustom && !p.apiKeyEnv.isEmpty()) {
    const QString env = qEnvironmentVariable(p.apiKeyEnv.toUtf8().constData());
    if (!env.isEmpty()) return env;
  }
  if (provider == "google") {
    const QString legacy = qEnvironmentVariable("GOOGLE_API_KEY");
    if (!legacy.isEmpty()) return legacy;
  }
  return {};
}

QString keySource(const QString& provider) {
  const auto stored = DataStore::providerKeys();
  if (stored.contains(provider) && !stored.value(provider).isEmpty()) return "stored";
  if (!resolveApiKey(provider).isEmpty()) return "env";
  return "none";
}

QString resolveBaseUrl(const QString& provider) {
  const ProviderConfig p = findProvider(provider);
  if (!p.baseUrlEnv.isEmpty()) {
    const QString env = qEnvironmentVariable(p.baseUrlEnv.toUtf8().constData());
    if (!env.isEmpty()) return env;
  }
  return p.defaultBaseUrl;
}

QString modelLabel(const QString& provider, const QString& model) {
  const ModelConfig m = findModel(provider, model);
  if (!m.name.isEmpty()) return m.name;
  return model;
}

QString providerGlyph(const QString& provider) {
  const ProviderConfig p = findProvider(provider);
  return p.glyph.isEmpty() ? provider.left(2).toUpper() : p.glyph;
}

QVector<ModelConfig> effectiveModels(const QString& provider) {
  const ProviderConfig p = findProvider(provider);
  QVector<ModelConfig> out = p.models;
  if (!p.isCustom) {
    const QJsonObject overrides = DataStore::providerModelOverrides();
    const QJsonObject po = overrides.value(provider).toObject();
    const QStringList hidden = jsonStringList(po.value("hideBuiltin"));
    QVector<ModelConfig> filtered;
    for (const auto& m : out)
      if (!hidden.contains(m.id)) filtered.push_back(m);
    out = filtered;
    for (const QJsonValue& v : po.value("models").toArray()) {
      const QJsonObject mo = v.toObject();
      const QString id = mo.value("id").toString();
      bool replaced = false;
      for (auto& m : out) {
        if (m.id == id) {
          m.name = mo.value("name").toString(m.name);
          if (mo.contains("supportsThinking")) m.supportsThinking = mo.value("supportsThinking").toBool();
          replaced = true;
        }
      }
      if (!replaced) {
        ModelConfig m = M(id, mo.value("name").toString(id), mo.value("supportsThinking").toBool());
        out.push_back(m);
      }
    }
  }
  if (out.isEmpty()) out.push_back(M(provider + "-default", "default", false, false, 128000, 8192, "fast", true));
  // Merge cached live models (fetched via refresh): live-only ids are appended
  // like the web /api/models merge, with thinking assumed supported.
  QSet<QString> seen;
  for (const auto& m : out) seen.insert(m.id);
  for (const QString& id : liveModelIds(provider)) {
    if (id.isEmpty() || seen.contains(id)) continue;
    seen.insert(id);
    ModelConfig m = M(id, id, true);
    m.liveOnly = true;
    out.push_back(m);
  }
  return out;
}

void setLiveModelIds(const QString& provider, const QStringList& ids) {
  QSettings s;
  QStringList clean;
  for (const QString& id : ids)
    if (!id.isEmpty() && !clean.contains(id)) clean.push_back(id);
  s.setValue(QStringLiteral("liveModels/") + provider, clean);
}

QStringList liveModelIds(const QString& provider) {
  QSettings s;
  return s.value(QStringLiteral("liveModels/") + provider).toStringList();
}

static QJsonObject overrideObj(const QString& provider) {
  return DataStore::providerModelOverrides();
}

void addProviderModel(const QString& provider, const ModelConfig& m) {
  QJsonObject all = DataStore::providerModelOverrides();
  QJsonObject po = all.value(provider).toObject();
  QJsonArray models = po.value("models").toArray();
  models.append(QJsonObject{{"id", m.id},
                            {"name", m.name},
                            {"supportsThinking", m.supportsThinking},
                            {"default", m.isDefault}});
  po.insert("models", models);
  all.insert(provider, po);
  DataStore::saveProviderModelOverrides(all);
}

void renameProviderModel(const QString& provider, const QString& oldId, const ModelConfig& m) {
  QJsonObject all = DataStore::providerModelOverrides();
  QJsonObject po = all.value(provider).toObject();
  QJsonArray hidden = po.value("hideBuiltin").toArray();
  bool builtin = false;
  for (const auto& b : builtinProviders())
    if (b.id == provider)
      for (const auto& bm : b.models)
        if (bm.id == oldId) builtin = true;
  if (builtin && oldId != m.id) hidden.append(oldId);
  po.insert("hideBuiltin", hidden);
  QJsonArray models = po.value("models").toArray();
  QJsonArray next;
  bool replaced = false;
  for (const QJsonValue& v : models) {
    if (v.toObject().value("id").toString() == oldId) {
      next.append(QJsonObject{{"id", m.id},
                              {"name", m.name},
                              {"supportsThinking", m.supportsThinking},
                              {"default", m.isDefault}});
      replaced = true;
    } else {
      next.append(v);
    }
  }
  if (!replaced)
    next.append(QJsonObject{{"id", m.id},
                            {"name", m.name},
                            {"supportsThinking", m.supportsThinking},
                            {"default", m.isDefault}});
  po.insert("models", next);
  all.insert(provider, po);
  DataStore::saveProviderModelOverrides(all);
}

void deleteProviderModel(const QString& provider, const QString& id, bool unhide) {
  QJsonObject all = DataStore::providerModelOverrides();
  QJsonObject po = all.value(provider).toObject();
  QJsonArray models = po.value("models").toArray();
  QJsonArray next;
  for (const QJsonValue& v : models)
    if (v.toObject().value("id").toString() != id) next.append(v);
  po.insert("models", next);
  if (unhide) {
    QJsonArray hidden = po.value("hideBuiltin").toArray();
    QJsonArray h;
    for (const QJsonValue& v : hidden)
      if (v.toString() != id) h.append(v);
    po.insert("hideBuiltin", h);
  } else {
    bool builtin = false;
    for (const auto& b : builtinProviders())
      if (b.id == provider)
        for (const auto& bm : b.models)
          if (bm.id == id) builtin = true;
    if (builtin) {
      QJsonArray hidden = po.value("hideBuiltin").toArray();
      hidden.append(id);
      po.insert("hideBuiltin", hidden);
    }
  }
  all.insert(provider, po);
  DataStore::saveProviderModelOverrides(all);
}

static QByteArray httpGetSync(const QString& url, const QMap<QString, QString>& headers, int timeoutMs,
                              bool* ok, int* status) {
  *ok = false;
  *status = 0;
  QNetworkAccessManager nam;
  QNetworkRequest req{QUrl(url)};
  req.setTransferTimeout(timeoutMs);
  for (auto it = headers.begin(); it != headers.end(); ++it) req.setRawHeader(it.key().toUtf8(), it.value().toUtf8());
  QNetworkReply* reply = nam.get(req);
  QEventLoop loop;
  QObject::connect(reply, &QNetworkReply::finished, &loop, &QEventLoop::quit);
  loop.exec();
  *status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
  *ok = reply->error() == QNetworkReply::NoError || *status == 200;
  const QByteArray body = reply->readAll();
  reply->deleteLater();
  return body;
}

LiveModelsOutcome fetchLiveModels(const QString& provider) {
  LiveModelsOutcome out;
  const ProviderConfig p = findProvider(provider);
  const QString base = resolveBaseUrl(provider);
  const QString key = resolveApiKey(provider);
  auto takeIds = [&](QVector<QString> ids) {
    // Mirror web caps (openai 100, opencode 200).
    const int cap = provider == "opencode" ? 200 : 100;
    if (provider == "google") {
      const QRegularExpression keep(QStringLiteral("gemini|gemma|learnlm"),
                                    QRegularExpression::CaseInsensitiveOption);
      QVector<QString> f;
      for (const QString& id : ids)
        if (keep.match(id).hasMatch()) f.push_back(id);
      ids = f;
    }
    while (ids.size() > cap) ids.pop_back();
    out.ids = ids;
    out.ok = !out.ids.isEmpty();
  };
  if (provider == "anthropic") {
    out.ok = true;
    for (const auto& m : p.models) out.ids.push_back(m.id);
    return out;
  }
  if (provider == "ollama") {
    bool ok = false;
    int status = 0;
    const QByteArray body = httpGetSync(base.left(base.indexOf("/v1")) + "/api/tags", {}, 8000, &ok, &status);
    if (ok) {
      const QJsonObject o = QJsonDocument::fromJson(body).object();
      QVector<QString> ids;
      for (const QJsonValue& v : o.value("models").toArray()) {
        const QString id = v.toObject().value("name").toString();
        if (!id.isEmpty()) ids.push_back(id);
      }
      takeIds(ids);
      if (!out.ok) out.error = "ollama returned no models";
    } else {
      out.error = "ollama not reachable";
    }
    return out;
  }
  if (provider == "google") {
    bool ok = false;
    int status = 0;
    const QByteArray body =
        httpGetSync(base + "/models?key=" + key, {}, 8000, &ok, &status);
    if (ok) {
      const QJsonObject o = QJsonDocument::fromJson(body).object();
      QVector<QString> ids;
      for (const QJsonValue& v : o.value("models").toArray()) {
        QString name = v.toObject().value("name").toString();
        name.remove("models/");
        if (!name.isEmpty()) ids.push_back(name);
      }
      takeIds(ids);
      if (!out.ok) out.error = "google returned no models";
    } else {
      out.error = "google list failed (" + QString::number(status) + ")";
    }
    return out;
  }
  QMap<QString, QString> headers;
  if (!key.isEmpty()) headers.insert("Authorization", "Bearer " + key);
  bool ok = false;
  int status = 0;
  const QByteArray body = httpGetSync(base + "/models", headers, 8000, &ok, &status);
  if (ok) {
    const QJsonObject o = QJsonDocument::fromJson(body).object();
    QJsonArray data = o.value("data").toArray();
    if (data.isEmpty()) data = o.value("models").toArray();
    QVector<QString> ids;
    for (const QJsonValue& v : data) {
      const QJsonObject mo = v.toObject();
      QString id = mo.value("id").toString();
      if (id.isEmpty()) id = mo.value("name").toString();
      id.remove("models/");
      if (!id.isEmpty()) ids.push_back(id);
    }
    takeIds(ids);
    if (!out.ok) out.error = "provider returned no models";
  } else {
    out.error = "list failed (" + QString::number(status) + ")";
  }
  return out;
}

}  // namespace omnia
