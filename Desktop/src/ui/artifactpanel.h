#pragma once

#include <QFrame>
#include <QLabel>
#include <QListWidget>
#include <QPushButton>
#include <QStackedWidget>

#include "core/types.h"

namespace omnia {

class ArtifactPanel : public QFrame {
  Q_OBJECT
 public:
  explicit ArtifactPanel(QWidget* parent = nullptr);
  void reload();
  void openArtifact(const QString& id);

 signals:
  void closeRequested();

 private:
  void showArtifact(const ArtifactMeta& a);
  void closeArtifact();
  QWidget* buildViewer(const ArtifactMeta& a);
  QListWidget* list_;
  QStackedWidget* stack_;
  QLabel* emptyLabel_;
  QLabel* titleLabel_;
  QWidget* tile_;
  QPushButton* backBtn_;
  QWidget* viewerHost_;
  QString currentId_;
};

}  // namespace omnia
