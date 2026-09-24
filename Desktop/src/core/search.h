#pragma once

#include "types.h"

namespace omnia {

QVector<SearchResult> searchWeb(const QString& query, int maxResults = 8, QString* engineOut = nullptr);
QVector<SearchResult> rankResults(QVector<SearchResult> results, const QString& query);

}  // namespace omnia
