#pragma once

#include <QFrame>
#include <QLabel>
#include <QList>
#include <QPlainTextEdit>
#include <QPushButton>

#include "core/types.h"

namespace omnia {

class Composer : public QFrame {
  Q_OBJECT
 public:
  explicit Composer(QWidget* parent = nullptr);
  void setSettings(const ChatSettings& s);
  void setBusy(bool busy);
  void setDisplay(const DisplaySettings& d);
  void clearInput();
  void setSeedText(const QString& text);

 signals:
  void sendRequested(const QString& text, const QList<FilePart>& files);
  void stopRequested();
  void settingsChanged(const ChatSettings& s);

 protected:
  void dragEnterEvent(QDragEnterEvent* e) override;
  void dragLeaveEvent(QDragLeaveEvent* e) override;
  void dropEvent(QDropEvent* e) override;
  bool eventFilter(QObject* watched, QEvent* e) override;

 private:
  void attachFiles(const QStringList& paths);
  void refreshToggles();
  void refreshChips();
  void rebuildModelMenu();
  void refreshModelLabel();

  ChatSettings settings_;
  DisplaySettings display_;
  QPlainTextEdit* input_;
  QList<FilePart> pending_;
  QWidget* chips_;
  QFrame* box_;
  QPushButton* sendBtn_;
  QPushButton* modelPill_;
  QHash<QString, QPushButton*> toggles_;
  bool busy_ = false;
  bool dragging_ = false;
  QList<QWidget*> chipWidgets_;
};

}  // namespace omnia
