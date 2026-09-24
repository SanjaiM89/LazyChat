#include "artifacts.h"

#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QRegularExpression>

#include "datastore.h"

namespace omnia {

QString artifactExtForType(const QString& type) {
  static const QHash<QString, QString> map = {
      {"text", "txt"},  {"code", "txt"},     {"markdown", "md"}, {"html", "html"},
      {"svg", "svg"},   {"image", "png"},    {"pdf", "pdf"},     {"docx", "docx"},
      {"xlsx", "xlsx"}, {"csv", "csv"},      {"mermaid", "mmd"}, {"table", "csv"},
      {"audio", "wav"},
  };
  return map.value(type, "txt");
}

QString artifactTypeForExt(const QString& ext) {
  const QString e = ext.toLower();
  static const QHash<QString, QString> map = {
      {"txt", "text"},   {"md", "markdown"}, {"markdown", "markdown"}, {"html", "html"},
      {"htm", "html"},   {"svg", "svg"},     {"png", "image"},         {"jpg", "image"},
      {"jpeg", "image"}, {"gif", "image"},   {"webp", "image"},        {"pdf", "pdf"},
      {"docx", "docx"},  {"xlsx", "xlsx"},   {"csv", "csv"},           {"json", "code"},
      {"js", "code"},    {"ts", "code"},     {"tsx", "code"},          {"jsx", "code"},
      {"py", "code"},    {"cpp", "code"},    {"c", "code"},            {"h", "code"},
      {"hpp", "code"},   {"java", "code"},   {"go", "code"},           {"rs", "code"},
      {"rb", "code"},    {"php", "code"},    {"sh", "code"},           {"bash", "code"},
      {"yml", "code"},   {"yaml", "code"},   {"toml", "code"},         {"xml", "code"},
      {"css", "code"},   {"sql", "code"},    {"mmd", "mermaid"},       {"wav", "audio"},
      {"mp3", "audio"},
  };
  return map.value(e, "text");
}

QString artifactMimeForType(const QString& type) {
  static const QHash<QString, QString> map = {
      {"text", "text/plain"},   {"code", "text/plain"},   {"markdown", "text/markdown"},
      {"html", "text/html"},    {"svg", "image/svg+xml"}, {"image", "image/png"},
      {"pdf", "application/pdf"},
      {"docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
      {"xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
      {"csv", "text/csv"},      {"mermaid", "text/plain"}, {"table", "text/csv"},
      {"audio", "audio/wav"},
  };
  return map.value(type, "text/plain");
}

static QString sanitizeFilename(QString name) {
  name.replace(QRegularExpression("[/\\\\:*?\"<>|]"), "_");
  name = name.trimmed();
  if (name.isEmpty()) name = "file";
  return name;
}

static QJsonArray readIndex() {
  return DataStore::read("artifacts/_index.json", QJsonArray()).toArray();
}

static void writeIndex(const QJsonArray& arr) { DataStore::write("artifacts/_index.json", arr); }

static ArtifactMeta metaFromJson(const QJsonObject& o) {
  ArtifactMeta a;
  a.id = o.value("id").toString();
  a.type = o.value("type").toString("text");
  a.title = o.value("title").toString();
  a.language = o.value("language").toString();
  a.conversationId = o.value("conversationId").toString();
  a.url = o.value("url").toString();
  a.filename = o.value("filename").toString();
  a.mime = o.value("mime").toString();
  a.createdAt = qint64(o.value("createdAt").toDouble());
  a.updatedAt = qint64(o.value("updatedAt").toDouble());
  a.content = o.value("content").toString();
  return a;
}

static QJsonObject metaToJson(const ArtifactMeta& a) {
  return QJsonObject{{"id", a.id},
                     {"type", a.type},
                     {"title", a.title},
                     {"language", a.language},
                     {"conversationId", a.conversationId},
                     {"url", a.url},
                     {"filename", a.filename},
                     {"mime", a.mime},
                     {"createdAt", double(a.createdAt)},
                     {"updatedAt", double(a.updatedAt)},
                     {"content", a.content}};
}

QVector<ArtifactMeta> listArtifacts(const QString& conversationId) {
  QVector<ArtifactMeta> out;
  for (const QJsonValue& v : readIndex()) {
    const ArtifactMeta a = metaFromJson(v.toObject());
    if (conversationId.isEmpty() || a.conversationId == conversationId) out.push_back(a);
  }
  return out;
}

ArtifactMeta getArtifact(const QString& id) {
  for (const QJsonValue& v : readIndex())
    if (v.toObject().value("id").toString() == id) return metaFromJson(v.toObject());
  return {};
}

static bool pushMeta(ArtifactMeta a) {
  QJsonArray arr = readIndex();
  QJsonArray next;
  bool replaced = false;
  for (const QJsonValue& v : arr) {
    if (v.toObject().value("id").toString() == a.id) {
      next.append(metaToJson(a));
      replaced = true;
    } else {
      next.append(v);
    }
  }
  if (!replaced) next.prepend(metaToJson(a));
  while (next.size() > 500) next.removeLast();
  writeIndex(next);
  return true;
}

ArtifactMeta createArtifact(const QString& title, const QString& type, const QString& content,
                            const QString& conversationId, const QString& language) {
  ArtifactMeta a;
  a.id = newId(12);
  a.type = type;
  a.title = title;
  a.language = language;
  a.conversationId = conversationId;
  const QString ext = artifactExtForType(type);
  a.filename = "artifact." + ext;
  a.mime = artifactMimeForType(type);
  a.url = "/api/files/" + a.id + "/" + a.filename;
  a.createdAt = a.updatedAt = nowMs();
  a.content = content;
  const QString dir = DataStore::dataDir() + "/artifacts/" + a.id;
  QDir().mkpath(dir);
  QFile f(dir + "/" + a.filename);
  if (f.open(QIODevice::WriteOnly)) {
    f.write(type == "image" || type == "pdf" || type == "docx" || type == "xlsx" || type == "audio"
                ? QByteArray::fromBase64(content.toLatin1())
                : content.toUtf8());
    f.close();
  }
  pushMeta(a);
  return a;
}

ArtifactMeta importArtifactFile(const QString& filename, const QByteArray& data,
                                const QString& conversationId) {
  const QFileInfo fi(filename);
  ArtifactMeta a;
  a.id = newId(12);
  a.type = artifactTypeForExt(fi.suffix());
  a.title = fi.completeBaseName();
  a.conversationId = conversationId;
  a.filename = sanitizeFilename(fi.fileName());
  a.mime = artifactMimeForType(a.type);
  a.url = "/api/files/" + a.id + "/" + a.filename;
  a.createdAt = a.updatedAt = nowMs();
  const QString dir = DataStore::dataDir() + "/artifacts/" + a.id;
  QDir().mkpath(dir);
  QFile f(dir + "/" + a.filename);
  if (f.open(QIODevice::WriteOnly)) {
    f.write(data);
    f.close();
  }
  const bool textual = a.type == "text" || a.type == "code" || a.type == "markdown" ||
                       a.type == "html" || a.type == "csv" || a.type == "svg" ||
                       a.type == "mermaid" || a.type == "table";
  if (textual && data.size() <= 2 * 1024 * 1024) a.content = QString::fromUtf8(data);
  pushMeta(a);
  return a;
}

bool deleteArtifact(const QString& id) {
  QJsonArray arr = readIndex();
  QJsonArray next;
  for (const QJsonValue& v : arr)
    if (v.toObject().value("id").toString() != id) next.append(v);
  writeIndex(next);
  QDir(DataStore::dataDir() + "/artifacts/" + id).removeRecursively();
  return true;
}

QString artifactFilePath(const ArtifactMeta& a) {
  return DataStore::dataDir() + "/artifacts/" + a.id + "/" + a.filename;
}

QByteArray readArtifactBuffer(const ArtifactMeta& a) {
  QFile f(artifactFilePath(a));
  if (f.open(QIODevice::ReadOnly)) return f.readAll();
  return a.content.toUtf8();
}

}  // namespace omnia
