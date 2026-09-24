#include "backgroundrunbar.h"

#include <QDateTime>
#include <QHBoxLayout>
#include <QMovie>
#include <QVBoxLayout>

#include "ui/icons.h"

namespace omnia {

BackgroundRunBar::BackgroundRunBar(QWidget* parent) : QFrame(parent) {
  setObjectName(QStringLiteral("runBar"));
  setStyleSheet(QStringLiteral(
      "#runBar { background-color:#24d9966a; border:1px solid #40d9966a; border-radius:16px; }"));
  auto* l = new QHBoxLayout(this);
  l->setContentsMargins(14, 10, 14, 10);
  l->setSpacing(10);

  spin_ = new QLabel();
  spin_->setPixmap(icon(QStringLiteral("loader-circle"), QColor(QStringLiteral("#d9966a"))).pixmap(14, 14));
  spinTimer_ = new QTimer(this);
  spinTimer_->setInterval(80);
  connect(spinTimer_, &QTimer::timeout, this, [this] {
    spinAngle_ = (spinAngle_ + 30) % 360;
    QPixmap pm = icon(QStringLiteral("loader-circle"), QColor(QStringLiteral("#d9966a"))).pixmap(14, 14);
    QTransform tr;
    tr.rotate(spinAngle_);
    spin_->setPixmap(pm.transformed(tr, Qt::SmoothTransformation));
  });
  l->addWidget(spin_);

  auto* col = new QVBoxLayout();
  col->setSpacing(2);
  col->setContentsMargins(0, 0, 0, 0);
  line1_ = new QLabel(QStringLiteral("Generating in the background"));
  line1_->setStyleSheet(
      QStringLiteral("font-size:12.5px; font-weight:500; color:#e8e6e2; background:transparent;"));
  line2_ = new QLabel();
  line2_->setStyleSheet(QStringLiteral("font-size:11px; color:#716c65; background:transparent;"));
  col->addWidget(line1_);
  col->addWidget(line2_);
  l->addLayout(col, 1);

  elapsedTimer_ = new QTimer(this);
  elapsedTimer_->setInterval(1000);
  connect(elapsedTimer_, &QTimer::timeout, this, [this] {
    line2_->setText(detail_.isEmpty()
                        ? elapsed() + QStringLiteral(" — keeps running if you switch chats")
                        : detail_ + QStringLiteral(" · ") + elapsed() +
                              QStringLiteral(" — keeps running if you switch chats"));
  });

  auto* show = new QPushButton();
  auto* sl = new QHBoxLayout(show);
  sl->setContentsMargins(0, 0, 0, 0);
  sl->setSpacing(6);
  sl->setAlignment(Qt::AlignCenter);
  auto* eye = new QLabel();
  eye->setPixmap(icon(QStringLiteral("eye"), QColor(QStringLiteral("#e8e6e2"))).pixmap(13, 13));
  auto* st = new QLabel(QStringLiteral("Show"));
  st->setStyleSheet(
      QStringLiteral("font-size:12px; font-weight:500; color:#e8e6e2; background:transparent; border:none;"));
  eye->setStyleSheet(QStringLiteral("background:transparent; border:none;"));
  sl->addWidget(eye);
  sl->addWidget(st);
  show->setFixedHeight(30);
  show->setCursor(Qt::PointingHandCursor);
  show->setStyleSheet(QStringLiteral(
      "QPushButton { background-color:#262524; border:1px solid #383634; border-radius:10px; }"
      "QPushButton:hover { border-color:#66d9966a; }"));
  connect(show, &QPushButton::clicked, this, &BackgroundRunBar::showRequested);
  l->addWidget(show);

  auto* stop = new QPushButton();
  auto* stl = new QHBoxLayout(stop);
  stl->setContentsMargins(0, 0, 0, 0);
  stl->setSpacing(6);
  stl->setAlignment(Qt::AlignCenter);
  auto* sq = new QLabel();
  sq->setPixmap(icon(QStringLiteral("square"), QColor(QStringLiteral("#e07870"))).pixmap(12, 12));
  auto* stt = new QLabel(QStringLiteral("Stop"));
  stt->setStyleSheet(
      QStringLiteral("font-size:12px; font-weight:500; color:#e07870; background:transparent; border:none;"));
  sq->setStyleSheet(QStringLiteral("background:transparent; border:none;"));
  stl->addWidget(sq);
  stl->addWidget(stt);
  stop->setFixedHeight(30);
  stop->setCursor(Qt::PointingHandCursor);
  stop->setStyleSheet(QStringLiteral(
      "QPushButton { background-color:#1fe07870; border:1px solid #33e07870; border-radius:10px; }"
      "QPushButton:hover { background-color:#33e07870; }"));
  connect(stop, &QPushButton::clicked, this, &BackgroundRunBar::stopRequested);
  l->addWidget(stop);

  hide();
}

void BackgroundRunBar::showRun(const QString& activity, const QString& detail, qint64 startedMs) {
  line1_->setText(QStringLiteral("Generating in the background — ") + activity);
  detail_ = detail;
  startedMs_ = startedMs;
  line2_->setText(detail_.isEmpty()
                      ? elapsed() + QStringLiteral(" — keeps running if you switch chats")
                      : detail_ + QStringLiteral(" · ") + elapsed() +
                            QStringLiteral(" — keeps running if you switch chats"));
  spinTimer_->start();
  elapsedTimer_->start();
  show();
}

QString BackgroundRunBar::elapsed() const {
  const qint64 s = qMax<qint64>(0, (QDateTime::currentMSecsSinceEpoch() - startedMs_) / 1000);
  if (s < 60) return QString::number(s) + QStringLiteral("s");
  const qint64 m = s / 60;
  if (m < 60)
    return QString::number(m) + QStringLiteral("m ") +
           QString::number(s % 60).rightJustified(2, QLatin1Char('0')) + QStringLiteral("s");
  return QString::number(m / 60) + QStringLiteral("h ") +
         QString::number(m % 60).rightJustified(2, QLatin1Char('0')) + QStringLiteral("m");
}

void BackgroundRunBar::hideRun() {
  spinTimer_->stop();
  elapsedTimer_->stop();
  hide();
}

}  // namespace omnia
