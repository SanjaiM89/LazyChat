#pragma once

#include <QMainWindow>
#include <QSplitter>
#include <QStackedWidget>

#include "core/chatengine.h"
#include "core/types.h"
#include "ui/agentspanel.h"
#include "ui/artifactpanel.h"
#include "ui/backgroundrunbar.h"
#include "ui/chatheader.h"
#include "ui/chatview.h"
#include "ui/composer.h"
#include "ui/sandboxpanel.h"
#include "ui/sidebar.h"
#include "ui/subchatpanel.h"

namespace omnia {

class MainWindow : public QMainWindow {
  Q_OBJECT
 public:
  explicit MainWindow(QWidget* parent = nullptr);

 protected:
  void closeEvent(QCloseEvent* e) override;

private:
  void applyTheme();
  void refreshSidebar();
  void openConversation(const QString& id);
  void newChat();
  void replay(const Conversation& c);
  void saveActiveConversation();
  void send(const QString& text, const QList<FilePart>& files);
  void stopRun();
  void wireEngine(ChatEngine* engine, bool isMain);
  void onEngineFinished(bool ok, const QString& error);
  void showPanel(Panel p);
  void togglePanel(Panel p);
  void updateRunBar();
  void updateSubchatIdle();
  void openApiKeys();
  void openDisplay();
  void openManageModels();
  void openSkills();
  void openConnections();
  void openSearchProviders();

  Sidebar* sidebar_;
  ChatHeader* header_;
  ChatView* view_;
  Composer* composer_;
  BackgroundRunBar* runBar_;
  ArtifactPanel* artifacts_;
  SandboxPanel* sandbox_;
  AgentsPanel* agents_;
  SubchatPanel* subchat_;
  QStackedWidget* rightStack_;
  QWidget* rightHost_;
  ChatEngine* engine_;
  ChatEngine* subEngine_;
  QVector<Conversation> conversations_;
  QString activeId_;
  ChatSettings settings_;
  DisplaySettings display_;
  bool busy_ = false;
  bool subBusy_ = false;
  bool sidebarVisible_ = true;
  bool streamingAssistant_ = false;
};

}  // namespace omnia
