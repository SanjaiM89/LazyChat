#pragma once

#include <QCheckBox>
#include <QFrame>
#include <QLabel>
#include <QLineEdit>
#include <QListWidget>
#include <QPlainTextEdit>
#include <QTableWidget>
#include <QTimer>

#include "core/types.h"

namespace omnia {

class AgentsPanel : public QFrame {
  Q_OBJECT
 public:
  explicit AgentsPanel(QWidget* parent = nullptr);
  void focusAgent(const QString& id);

 signals:
  void closeRequested();
  void openArtifactRequested(const QString& id);

 private:
  void refreshList();
  void refreshDetail();
  void spawn();
  void stopSelected();

  QListWidget* list_;
  QLabel* detailTitle_;
  QLabel* statusLabel_;
  QPlainTextEdit* taskLabel_;
  QPlainTextEdit* logView_;
  QLabel* shot_;
  QTableWidget* files_;
  QLineEdit* spawnTask_;
  QCheckBox* researchBox_;
  QLabel* runningBadge_;
  QLabel* emptyLabel_;
  QTimer* timer_;
  QString currentId_;
};

}  // namespace omnia
