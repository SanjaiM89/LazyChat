#pragma once

#include <QObject>

#include "types.h"

namespace omnia {

class ChromiumService : public QObject {
  Q_OBJECT
 public:
  static ChromiumService& instance();

  Control control() const;
  void setControl(Control c);
  QVector<ChromiumStep> steps() const;
  void clearTimeline();
  void recordStep(const QString& actor, const QString& action, const QString& detail,
                  const QString& url = {}, const QString& title = {}, const QString& shot = {});

  bool ensure(QString* error = nullptr);
  bool ready() const;

  ChromiumResult navigate(const QString& actor, const QString& url);
  ChromiumResult click(const QString& actor, int x, int y, const QString& label = {});
  ChromiumResult clickSelector(const QString& actor, const QString& selector);
  ChromiumResult typeText(const QString& actor, const QString& text, bool enter);
  ChromiumResult press(const QString& actor, const QString& key);
  ChromiumResult scroll(const QString& actor, const QString& direction, int px = 500);
  ChromiumResult nav(const QString& actor, const QString& op);
  ChromiumResult read();
  ChromiumResult shot();
  ChromiumSearchOutcome search(const QString& actor, const QString& query, int max = 8);

 signals:
  void timelineChanged();
  void controlChanged();

 private:
  ChromiumService();
  void load();
  void save();
  ChromiumResult post(const QString& path, const QJsonObject& body, int timeoutMs = 60000);
  ChromiumResult get(const QString& path, int timeoutMs = 20000);
  ChromiumTimeline timeline_;
};

}  // namespace omnia
