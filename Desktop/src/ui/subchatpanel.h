#pragma once

#include <QFrame>
#include <QLabel>
#include <QPlainTextEdit>
#include <QPushButton>

#include "chatview.h"
#include "core/types.h"

namespace omnia {

class SubchatPanel : public QFrame {
  Q_OBJECT
 public:
  explicit SubchatPanel(QWidget* parent = nullptr);
  ChatView* view() const { return view_; }
  void setBusy(bool busy);
  void setSeed(const QString& text);
  void setStatus(const QString& s);
  void reset();

 signals:
  void sendRequested(const QString& text);
  void stopRequested();
  void closeRequested();

 private:
  ChatView* view_;
  QPlainTextEdit* input_;
  QPushButton* sendBtn_;
  QLabel* status_;
  QWidget* empty_;
  bool busy_ = false;
};

}  // namespace omnia
