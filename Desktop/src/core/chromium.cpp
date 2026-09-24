#include "chromium.h"

#include <QEventLoop>
#include <QFile>
#include <QJsonArray>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QThread>

#include "datastore.h"
#include "sandbox.h"

namespace omnia {

static const QString kDaemonUrl = qEnvironmentVariable("CHROMIUM_DAEMON_URL", "http://127.0.0.1:18787");

ChromiumService& ChromiumService::instance() {
  static ChromiumService s;
  return s;
}

ChromiumService::ChromiumService() : QObject(nullptr) { load(); }

void ChromiumService::load() {
  const QJsonObject o = DataStore::read("chromium-timeline.json", QJsonObject()).toObject();
  timeline_.control = o.value("control").toString() == "user" ? Control::User : Control::Model;
  timeline_.controlAt = qint64(o.value("controlAt").toDouble());
  timeline_.steps.clear();
  for (const QJsonValue& v : o.value("steps").toArray()) {
    const QJsonObject so = v.toObject();
    ChromiumStep s;
    s.i = int(so.value("i").toDouble());
    s.t = qint64(so.value("t").toDouble());
    s.actor = so.value("actor").toString();
    s.action = so.value("action").toString();
    s.detail = so.value("detail").toString();
    s.url = so.value("url").toString();
    s.title = so.value("title").toString();
    s.shot = so.value("shot").toString();
    timeline_.steps.push_back(s);
  }
}

void ChromiumService::save() {
  QJsonArray arr;
  for (const auto& s : timeline_.steps)
    arr.append(QJsonObject{{"i", s.i},
                           {"t", double(s.t)},
                           {"actor", s.actor},
                           {"action", s.action},
                           {"detail", s.detail},
                           {"url", s.url},
                           {"title", s.title},
                           {"shot", s.shot}});
  DataStore::write("chromium-timeline.json",
                   QJsonObject{{"control", timeline_.control == Control::User ? "user" : "model"},
                               {"controlAt", double(timeline_.controlAt)},
                               {"steps", arr}});
}

Control ChromiumService::control() const { return timeline_.control; }

void ChromiumService::setControl(Control c) {
  timeline_.control = c;
  timeline_.controlAt = nowMs();
  save();
  emit controlChanged();
}

QVector<ChromiumStep> ChromiumService::steps() const { return timeline_.steps; }

void ChromiumService::clearTimeline() {
  timeline_.steps.clear();
  save();
  emit timelineChanged();
}

void ChromiumService::recordStep(const QString& actor, const QString& action, const QString& detail,
                                 const QString& url, const QString& title, const QString& shot) {
  ChromiumStep s;
  s.i = timeline_.steps.isEmpty() ? 1 : timeline_.steps.last().i + 1;
  s.t = nowMs();
  s.actor = actor;
  s.action = action;
  s.detail = detail.left(500);
  s.url = url;
  s.title = title;
  s.shot = shot;
  timeline_.steps.push_back(s);
  while (timeline_.steps.size() > 80) timeline_.steps.removeFirst();
  save();
  emit timelineChanged();
}

ChromiumResult ChromiumService::get(const QString& path, int timeoutMs) {
  ChromiumResult r;
  QNetworkAccessManager nam;
  QNetworkRequest req{QUrl(kDaemonUrl + path)};
  req.setTransferTimeout(timeoutMs);
  QNetworkReply* reply = nam.get(req);
  QEventLoop loop;
  QObject::connect(reply, &QNetworkReply::finished, &loop, &QEventLoop::quit);
  loop.exec();
  const QJsonObject o = QJsonDocument::fromJson(reply->readAll()).object();
  reply->deleteLater();
  r.url = o.value("url").toString();
  r.title = o.value("title").toString();
  r.text = o.value("text").toString();
  r.image = o.value("image").toString();
  return r;
}

ChromiumResult ChromiumService::post(const QString& path, const QJsonObject& body, int timeoutMs) {
  ChromiumResult r;
  QNetworkAccessManager nam;
  QNetworkRequest req{QUrl(kDaemonUrl + path)};
  req.setTransferTimeout(timeoutMs);
  req.setRawHeader("Content-Type", "application/json");
  QNetworkReply* reply = nam.post(req, QJsonDocument(body).toJson());
  QEventLoop loop;
  QObject::connect(reply, &QNetworkReply::finished, &loop, &QEventLoop::quit);
  loop.exec();
  const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
  const QJsonObject o = QJsonDocument::fromJson(reply->readAll()).object();
  reply->deleteLater();
  if (status >= 400) {
    r.ok = false;
    r.error = o.value("error").toString("daemon " + QString::number(status));
  }
  r.url = o.value("url").toString();
  r.title = o.value("title").toString();
  r.text = o.value("text").toString();
  r.image = o.value("image").toString();
  return r;
}

bool ChromiumService::ready() const {
  QNetworkAccessManager nam;
  QNetworkRequest req{QUrl(kDaemonUrl + "/state")};
  req.setTransferTimeout(4000);
  QNetworkReply* reply = nam.get(req);
  QEventLoop loop;
  QObject::connect(reply, &QNetworkReply::finished, &loop, &QEventLoop::quit);
  loop.exec();
  const bool ok = reply->error() == QNetworkReply::NoError;
  reply->deleteLater();
  return ok;
}

bool ChromiumService::ensure(QString* error) {
  if (ready()) return true;
  auto& sb = SandboxService::instance();
  QString sandboxId;
  {
    const QJsonObject session = DataStore::read("chromium-session.json", QJsonObject()).toObject();
    sandboxId = session.value("sandboxId").toString();
    bool found = false;
    if (!sandboxId.isEmpty()) {
      for (const auto& s : sb.listSandboxes())
        if (s.id == sandboxId) found = true;
    }
    if (!found) {
      const SandboxMeta meta = sb.createSandbox("Chromium", {});
      sandboxId = meta.id;
      DataStore::write("chromium-session.json", QJsonObject{{"sandboxId", sandboxId}});
    }
  }
  sb.exec(sandboxId,
          "pkill -f browser-daemon.mjs 2>/dev/null; nohup node /app/browser-daemon.mjs "
          "> /tmp/browser-daemon.log 2>&1 & echo started",
          30000);
  for (int i = 0; i < 30; ++i) {
    if (ready()) return true;
    QThread::msleep(1500);
  }
  if (error) *error = "Chromium daemon did not start (image may need npm run sandbox:build).";
  return false;
}

ChromiumResult ChromiumService::navigate(const QString& actor, const QString& url) {
  const auto r = post("/navigate", {{"url", url}}, 60000);
  if (r.ok) recordStep(actor, "navigate", url, r.url, r.title, r.image);
  return r;
}

ChromiumResult ChromiumService::click(const QString& actor, int x, int y, const QString& label) {
  const auto r = post("/click", {{"x", x}, {"y", y}});
  if (r.ok)
    recordStep(actor, "click", label.isEmpty() ? QString("click (%1, %2)").arg(x).arg(y) : label,
               r.url, r.title, r.image);
  return r;
}

ChromiumResult ChromiumService::clickSelector(const QString& actor, const QString& selector) {
  const auto r = post("/click", {{"selector", selector}});
  if (r.ok) recordStep(actor, "click", "click (" + selector + ")", r.url, r.title, r.image);
  return r;
}

ChromiumResult ChromiumService::typeText(const QString& actor, const QString& text, bool enter) {
  const auto r = post("/type", {{"text", text}, {"enter", enter}});
  if (r.ok)
    recordStep(actor, "type", QString("type \"%1\"%2").arg(text.left(80), enter ? " + Enter" : ""),
               r.url, r.title, r.image);
  return r;
}

ChromiumResult ChromiumService::press(const QString& actor, const QString& key) {
  const auto r = post("/press", {{"key", key}});
  if (r.ok) recordStep(actor, "press", "press " + key, r.url, r.title, r.image);
  return r;
}

ChromiumResult ChromiumService::scroll(const QString& actor, const QString& direction, int px) {
  const auto r = post("/scroll", {{"direction", direction}, {"px", px}});
  if (r.ok) recordStep(actor, "scroll", "scroll " + direction, r.url, r.title, r.image);
  return r;
}

ChromiumResult ChromiumService::nav(const QString& actor, const QString& op) {
  const auto r = post("/" + op, {}, 45000);
  if (r.ok) recordStep(actor, op, op, r.url, r.title, r.image);
  return r;
}

ChromiumResult ChromiumService::read() {
  const auto r = get("/text?max=12000");
  recordStep("model", "read", (r.title.isEmpty() ? r.url : r.title).left(120), r.url, r.title, {});
  return r;
}

ChromiumResult ChromiumService::shot() { return get("/screenshot"); }

ChromiumSearchOutcome ChromiumService::search(const QString& actor, const QString& query, int max) {
  ChromiumSearchOutcome out;
  out.query = query;
  QNetworkAccessManager nam;
  QNetworkRequest req{QUrl(kDaemonUrl + "/search")};
  req.setTransferTimeout(90000);
  req.setRawHeader("Content-Type", "application/json");
  QNetworkReply* reply =
      nam.post(req, QJsonDocument(QJsonObject{{"query", query}, {"max", max}}).toJson());
  QEventLoop loop;
  QObject::connect(reply, &QNetworkReply::finished, &loop, &QEventLoop::quit);
  loop.exec();
  const QJsonObject o = QJsonDocument::fromJson(reply->readAll()).object();
  reply->deleteLater();
  out.engine = o.value("engine").toString();
  out.image = o.value("image").toString();
  int i = 1;
  for (const QJsonValue& v : o.value("results").toArray()) {
    const QJsonObject ro = v.toObject();
    SearchResult r;
    r.position = int(ro.value("position").toDouble(i));
    r.title = ro.value("title").toString();
    r.url = ro.value("url").toString();
    r.hostname = ro.value("hostname").toString();
    out.results.push_back(r);
    i++;
  }
  recordStep(actor, "search",
             out.engine + ": \"" + query + "\" → " + QString::number(out.results.size()) +
                 " results",
             o.value("url").toString(), o.value("title").toString(), out.image);
  return out;
}

}  // namespace omnia
