#include "search.h"

#include <QEventLoop>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QRegularExpression>
#include <QSet>
#include <QThread>
#include <QUrl>

#include "datastore.h"
#include "models.h"

namespace omnia {

static QString hostOf(const QString& url) {
  const QUrl u(url);
  QString h = u.host();
  h.remove(QRegularExpression("^www\\."));
  return h;
}

static QByteArray httpJson(const QString& url, const QJsonObject& body, const QMap<QString, QString>& headers,
                           const QString& method, int* status) {
  QNetworkAccessManager nam;
  QNetworkRequest req{QUrl(url)};
  req.setTransferTimeout(20000);
  req.setRawHeader("Content-Type", "application/json");
  req.setRawHeader("User-Agent",
                   "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36");
  for (auto it = headers.begin(); it != headers.end(); ++it)
    req.setRawHeader(it.key().toUtf8(), it.value().toUtf8());
  QNetworkReply* reply = method == "POST" ? nam.post(req, QJsonDocument(body).toJson())
                                          : nam.get(req);
  QEventLoop loop;
  QObject::connect(reply, &QNetworkReply::finished, &loop, &QEventLoop::quit);
  loop.exec();
  *status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
  const QByteArray data = reply->readAll();
  reply->deleteLater();
  return data;
}

static QString resolveKey(const SearchProviderDef& d) {
  if (!d.apiKey.isEmpty()) return d.apiKey;
  if (!d.apiKeyEnv.isEmpty()) return qEnvironmentVariable(d.apiKeyEnv.toUtf8().constData());
  return {};
}

static QVector<SearchResult> fromJsonResults(const QJsonArray& arr) {
  QVector<SearchResult> out;
  int i = 1;
  for (const QJsonValue& v : arr) {
    const QJsonObject o = v.toObject();
    SearchResult r;
    r.position = i++;
    r.title = o.value("title").toString();
    r.url = o.value("url").toString();
    r.hostname = o.value("hostname").toString(hostOf(r.url));
    r.description = o.value("description").toString(o.value("snippet").toString());
    if (!r.url.isEmpty() && !r.title.isEmpty()) out.push_back(r);
  }
  return out;
}

static QVector<SearchResult> searchTavily(const SearchProviderDef& d, const QString& query, int max) {
  int status = 0;
  const QByteArray body = httpJson("https://api.tavily.com/search",
                                   {{"query", query}, {"max_results", max}, {"include_answer", false}},
                                   {{"Authorization", "Bearer " + resolveKey(d)}}, "POST", &status);
  if (status != 200) return {};
  return fromJsonResults(QJsonDocument::fromJson(body).object().value("results").toArray());
}

static QVector<SearchResult> searchBrave(const SearchProviderDef& d, const QString& query, int max) {
  int status = 0;
  const QString url = "https://api.search.brave.com/res/v1/web/search?count=" + QString::number(max) +
                      "&q=" + QUrl::toPercentEncoding(query);
  const QByteArray body =
      httpJson(url, {}, {{"X-Subscription-Token", resolveKey(d)}}, "GET", &status);
  if (status != 200) return {};
  QJsonArray arr;
  const QJsonArray web =
      QJsonDocument::fromJson(body).object().value("web").toObject().value("results").toArray();
  for (const QJsonValue& v : web) {
    const QJsonObject o = v.toObject();
    arr.append(QJsonObject{{"title", o.value("title").toString()},
                           {"url", o.value("url").toString()},
                           {"description", o.value("description").toString()}});
  }
  return fromJsonResults(arr);
}

static QVector<SearchResult> searchSerper(const SearchProviderDef& d, const QString& query, int max) {
  int status = 0;
  const QByteArray body = httpJson("https://google.serper.dev/search",
                                   {{"q", query}, {"num", max}},
                                   {{"X-API-KEY", resolveKey(d)}}, "POST", &status);
  if (status != 200) return {};
  const QJsonObject o = QJsonDocument::fromJson(body).object();
  QJsonArray arr;
  for (const QJsonValue& v : o.value("organic").toArray()) {
    const QJsonObject ro = v.toObject();
    arr.append(QJsonObject{{"title", ro.value("title").toString()},
                           {"url", ro.value("link").toString()},
                           {"description", ro.value("snippet").toString()}});
  }
  return fromJsonResults(arr);
}

static QVector<SearchResult> searchSearxng(const SearchProviderDef& d, const QString& query, int max) {
  int status = 0;
  QString base = d.baseUrl;
  while (base.endsWith('/')) base.chop(1);
  const QString url = base + "/search?format=json&count=" + QString::number(max) +
                      "&q=" + QUrl::toPercentEncoding(query);
  const QByteArray body = httpJson(url, {}, {}, "GET", &status);
  if (status != 200) return {};
  QJsonArray arr;
  const QJsonArray results = QJsonDocument::fromJson(body).object().value("results").toArray();
  for (const QJsonValue& v : results) {
    const QJsonObject o = v.toObject();
    arr.append(QJsonObject{{"title", o.value("title").toString()},
                           {"url", o.value("url").toString()},
                           {"description", o.value("content").toString()}});
  }
  return fromJsonResults(arr);
}

static QString stripHtml(QString s) {
  s.replace(QRegularExpression("<[^>]+>"), "");
  s.replace("&amp;", "&");
  s.replace("&quot;", "\"");
  s.replace("&#x27;", "'");
  s.replace("&lt;", "<");
  s.replace("&gt;", ">");
  s.replace("&nbsp;", " ");
  return s.trimmed();
}

static QVector<SearchResult> searchDdg(const QString& query, int max) {
  int status = 0;
  const QString url = "https://html.duckduckgo.com/html/?kl=wt-wt&q=" + QUrl::toPercentEncoding(query);
  const QByteArray body = httpJson(url, {}, {}, "GET", &status);
  if (status != 200) return {};
  const QString html = QString::fromUtf8(body);
  QVector<SearchResult> out;
  QRegularExpression blockRe("<a[^>]*class=\"result__a\"[^>]*href=\"([^\"]+)\"[^>]*>([\\s\\S]*?)</a>");
  QRegularExpression snipRe("class=\"result__snippet\"[^>]*>([\\s\\S]*?)</a>");
  QSet<QString> seen;
  auto it = blockRe.globalMatch(html);
  while (it.hasNext() && out.size() < max) {
    const auto m = it.next();
    QString link = m.captured(1);
    if (link.contains("duckduckgo.com/l/")) {
      QRegularExpression uddg("uddg=([^&]+)");
      const auto um = uddg.match(link);
      if (um.hasMatch()) link = QUrl::fromPercentEncoding(um.captured(1).toUtf8());
    }
    const QString title = stripHtml(m.captured(2));
    if (title.isEmpty() || link.isEmpty() || seen.contains(link)) continue;
    seen.insert(link);
    SearchResult r;
    r.position = out.size() + 1;
    r.title = title;
    r.url = link;
    r.hostname = hostOf(link);
    const int idx = int(m.capturedStart());
    const int snipIdx = html.indexOf(snipRe, idx);
    if (snipIdx >= 0 && snipIdx - idx < 4000) {
      const auto sm = snipRe.match(html, snipIdx);
      if (sm.hasMatch()) r.description = stripHtml(sm.captured(1));
    }
    out.push_back(r);
  }
  return out;
}

QVector<SearchResult> searchWeb(const QString& query, int maxResults, QString* engineOut) {
  static qint64 lastCall = 0;
  static QHash<QString, QPair<qint64, QVector<SearchResult>>> cache;
  const qint64 now = nowMs();

  const QString cacheKey = query + "|" + QString::number(maxResults);
  if (cache.contains(cacheKey) && now - cache.value(cacheKey).first < 4 * 60 * 1000) {
    if (engineOut) *engineOut = "cache";
    return cache.value(cacheKey).second;
  }
  if (lastCall && now - lastCall < 1400) QThread::msleep(1400 - (now - lastCall));
  lastCall = nowMs();

  QVector<SearchResult> results;
  QString engine;
  for (const auto& d : listEnabledSearchProviders()) {
    if (d.kind == "duckduckgo") continue;
    const QString key = resolveKey(d);
    if (d.kind != "searxng" && key.isEmpty()) continue;
    if (d.kind == "searxng" && d.baseUrl.isEmpty()) continue;
    try {
      if (d.kind == "tavily") results = searchTavily(d, query, maxResults);
      else if (d.kind == "brave") results = searchBrave(d, query, maxResults);
      else if (d.kind == "serper") results = searchSerper(d, query, maxResults);
      else if (d.kind == "searxng") results = searchSearxng(d, query, maxResults);
    } catch (...) {
      results.clear();
    }
    if (!results.isEmpty()) {
      engine = d.kind;
      break;
    }
  }
  if (results.isEmpty()) {
    results = searchDdg(query, maxResults);
    engine = "duckduckgo";
  }
  results = rankResults(results, query);
  if (engineOut) *engineOut = engine;
  cache.insert(cacheKey, {nowMs(), results});
  while (cache.size() > 64) cache.erase(cache.begin());
  return results;
}

QVector<SearchResult> rankResults(QVector<SearchResult> results, const QString& query) {
  const QStringList terms =
      query.toLower().split(QRegularExpression("[^\\w]+"), Qt::SkipEmptyParts);
  for (auto& r : results) {
    const QString hay = (r.title + " " + r.description).toLower();
    int score = 0;
    for (const QString& t : terms)
      if (hay.contains(t)) score++;
    r.position = r.position * 10 - score;
  }
  std::sort(results.begin(), results.end(),
            [](const SearchResult& a, const SearchResult& b) { return a.position < b.position; });
  for (int i = 0; i < results.size(); ++i) results[i].position = i + 1;
  return results;
}

}  // namespace omnia
