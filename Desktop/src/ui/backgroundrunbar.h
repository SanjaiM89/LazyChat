#pragma once

#include <QFrame>
#include <QLabel>
#include <QPushButton>
#include <QTimer>

namespace omnia {

class BackgroundRunBar : public QFrame {
  Q_OBJECT
 public:
  explicit BackgroundRunBar(QWidget* parent = nullptr);
  void showRun(const QString& activity, const QString& detail, qint64 startedMs);
  void hideRun();

 signals:
  void showRequested();
  void stopRequested();

 private:
  QString elapsed() const;
  QLabel* line1_;
  QLabel* line2_;
  QLabel* spin_;
  QTimer* spinTimer_;
  QTimer* elapsedTimer_;
  QString detail_;
  qint64 startedMs_ = 0;
  int spinAngle_ = 0;
};

}  // namespace omnia
