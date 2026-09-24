#pragma once

#include "types.h"

namespace omnia {

QString artifactExtForType(const QString& type);
QString artifactTypeForExt(const QString& ext);
QString artifactMimeForType(const QString& type);

QVector<ArtifactMeta> listArtifacts(const QString& conversationId = QString());
ArtifactMeta getArtifact(const QString& id);
ArtifactMeta createArtifact(const QString& title, const QString& type, const QString& content,
                            const QString& conversationId = {}, const QString& language = {});
ArtifactMeta importArtifactFile(const QString& filename, const QByteArray& data,
                                const QString& conversationId = {});
bool deleteArtifact(const QString& id);
QString artifactFilePath(const ArtifactMeta& a);
QByteArray readArtifactBuffer(const ArtifactMeta& a);

}  // namespace omnia
