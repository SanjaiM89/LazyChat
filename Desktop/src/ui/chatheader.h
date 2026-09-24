#pragma once

#include <QFrame>
#include <QLabel>
#include <QPushButton>
#include <QToolButton>

#include "core/types.h"

namespace omnia {

class ChatHeader : public QFrame {
  Q_OBJECT
 public:
  explicit ChatHeader(QWidget* parent = nullptr);
  void setSettings(const ChatSettings& settings);
  void setStatus(const QString& status, const QString& detail);
  void setActiveRun(bool active);
  void setTitle(const QString& title);
  void setPanelActive(int panel, bool active);
  void setSidebarVisible(bool visible);
  void setKeyReady(bool ready);
  void refreshLiveModels();

 signals:
  void settingsChanged(const ChatSettings& settings);
  void openApiKeys();
  void openDisplaySettings();
  void openManageModels();
  void toggleSidebar();
  void togglePanel(int panel);

 private:
  void rebuildMenu();
  ChatSettings settings_;
  QToolButton* modelBtn_;
  QLabel* titleLabel_;
  QLabel* statusLabel_;
  QLabel* keyDot_;
  QPushButton* artBtn_;
  QPushButton* sandBtn_;
  QPushButton* agentBtn_;
  QPushButton* sideBtn_;
};

}  // namespace omnia
