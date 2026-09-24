#pragma once

#include <QFrame>
#include <QLabel>
#include <QLineEdit>
#include <QListWidget>
#include <QPushButton>
#include <QTabWidget>
#include <QTextEdit>
#include <QTimer>

#include "core/types.h"

namespace omnia {

class SandboxPanel : public QFrame {
  Q_OBJECT
 public:
  explicit SandboxPanel(QWidget* parent = nullptr);

 signals:
  void closeRequested();
  void openArtifactRequested(const QString& id);

 protected:
  bool eventFilter(QObject* watched, QEvent* e) override;
  void showEvent(QShowEvent* e) override;
  void hideEvent(QHideEvent* e) override;

 private:
  // computer tab
  void refreshShot();
  void refreshTimeline();
  void updateControlUi();
  void ensureBrowser();
  void gotoUrl();
  void sendLine();
  void toggleFullscreen();
  void onShotClick(const QPoint& pos);
  void applyShot(const QByteArray& png);

  // sandboxes tab
  void refreshHealth();
  void refreshSandboxList();
  void spawnSandbox();
  void killSelected();
  void startSelected();
  void deleteSelected();
  void runExec();

  QLabel* shot_;
  QLabel* controlBadge_;
  QLabel* urlTitle_;
  QLineEdit* urlBar_;
  QLineEdit* typeBar_;
  QLineEdit* execBar_;
  QTextEdit* execOut_;
  QLineEdit* labelBar_;
  QListWidget* filmstrip_;
  QListWidget* sandboxList_;
  QLabel* healthLabel_;
  QLabel* statusBadge_;
  QPushButton* takeBtn_;
  QPushButton* fullBtn_;
  QTimer* shotTimer_;
  QTimer* timelineTimer_;
  QPixmap lastPpm_;
  QPixmap displayed_;
  bool userDriving_ = false;
  bool fullscreen_ = false;
  QWidget* browserChrome_ = nullptr;
  QTabWidget* tabs_ = nullptr;
};

}  // namespace omnia
