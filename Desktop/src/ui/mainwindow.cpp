#include "mainwindow.h"

#include <QAction>
#include <QCloseEvent>
#include <QFile>
#include <QHBoxLayout>
#include <QInputDialog>
#include <QLabel>
#include <QMenuBar>
#include <QMessageBox>
#include <QPushButton>
#include <QStatusBar>
#include <QVBoxLayout>

#include "core/artifacts.h"
#include "core/datastore.h"
#include "core/display.h"
#include "core/mcp.h"
#include "core/models.h"
#include "dialogs.h"
#include "ui/icons.h"

namespace omnia {

MainWindow::MainWindow(QWidget* parent) : QMainWindow(parent) {
  setWindowTitle(QStringLiteral("Omnia"));
  resize(1360, 860);
  applyTheme();

  settings_ = loadChatSettings();
  display_ = loadDisplay();

  auto* central = new QWidget();
  auto* root = new QVBoxLayout(central);
  root->setContentsMargins(0, 0, 0, 0);
  root->setSpacing(0);

  auto* split = new QSplitter(Qt::Horizontal);
  split->setChildrenCollapsible(false);
  split->setHandleWidth(4);
  split->setStyleSheet(QStringLiteral(
      "QSplitter::handle { background-color:#1a1918; width:4px; }"
      "QSplitter::handle:hover { background-color:#383634; }"));
  root->addWidget(split, 1);

  sidebar_ = new Sidebar();
  split->addWidget(sidebar_);

  auto* centerWrap = new QWidget();
  auto* center = new QVBoxLayout(centerWrap);
  center->setContentsMargins(0, 0, 0, 0);
  center->setSpacing(0);

  header_ = new ChatHeader();
  center->addWidget(header_);

  runBar_ = new BackgroundRunBar();
  auto* runWrap = new QWidget();
  auto* rw = new QVBoxLayout(runWrap);
  rw->setContentsMargins(24, 8, 24, 0);
  rw->setSpacing(0);
  rw->addWidget(runBar_);
  center->addWidget(runWrap);

  auto* mid = new QHBoxLayout();
  mid->setContentsMargins(0, 0, 0, 0);
  mid->setSpacing(0);

  auto* chatCol = new QVBoxLayout();
  chatCol->setContentsMargins(0, 0, 0, 0);
  chatCol->setSpacing(0);
  view_ = new ChatView();
  view_->setDisplay(display_);
  chatCol->addWidget(view_, 1);
  composer_ = new Composer();
  composer_->setSettings(settings_);
  composer_->setDisplay(display_);
  chatCol->addWidget(composer_);
  auto* chatWrap = new QWidget();
  chatWrap->setLayout(chatCol);
  mid->addWidget(chatWrap, 1);

  subchat_ = new SubchatPanel();
  subchat_->hide();
  mid->addWidget(subchat_, 0);

  center->addLayout(mid, 1);
  split->addWidget(centerWrap);

  rightHost_ = new QWidget();
  rightHost_->setFixedWidth(430);
  rightHost_->setObjectName(QStringLiteral("rightHost"));
  rightHost_->setStyleSheet(QStringLiteral("border-left:1px solid #383634; background-color:#1a1918;"));
  auto* rightLay = new QVBoxLayout(rightHost_);
  rightLay->setContentsMargins(0, 0, 0, 0);
  rightLay->setSpacing(0);
  rightStack_ = new QStackedWidget();
  rightStack_->setMinimumWidth(0);
  artifacts_ = new ArtifactPanel();
  sandbox_ = new SandboxPanel();
  agents_ = new AgentsPanel();
  rightStack_->addWidget(new QWidget());
  rightStack_->addWidget(artifacts_);
  rightStack_->addWidget(sandbox_);
  rightStack_->addWidget(agents_);
  rightLay->addWidget(rightStack_);
  rightHost_->hide();
  split->addWidget(rightHost_);

  split->setStretchFactor(0, 0);
  split->setStretchFactor(1, 1);
  split->setStretchFactor(2, 0);
  setCentralWidget(central);

  engine_ = new ChatEngine(this);
  subEngine_ = new ChatEngine(this);
  wireEngine(engine_, true);
  wireEngine(subEngine_, false);

  connect(sidebar_, &Sidebar::conversationSelected, this, &MainWindow::openConversation);
  connect(sidebar_, &Sidebar::newChatRequested, this, &MainWindow::newChat);
  connect(sidebar_, &Sidebar::deleteConversationRequested, this, [this](const QString& id) {
    DataStore::deleteConversation(id);
    conversations_ = DataStore::listConversations();
    if (activeId_ == id) {
      activeId_.clear();
      if (!conversations_.isEmpty())
        openConversation(conversations_.first().id);
      else
        newChat();
    }
    refreshSidebar();
  });
  connect(sidebar_, &Sidebar::openSkills, this, &MainWindow::openSkills);
  connect(sidebar_, &Sidebar::openConnections, this, &MainWindow::openConnections);
  connect(sidebar_, &Sidebar::openSearchProviders, this, &MainWindow::openSearchProviders);

  connect(header_, &ChatHeader::settingsChanged, this, [this](const ChatSettings& s) {
    settings_ = s;
    saveChatSettings(s);
    composer_->setSettings(s);
    updateSubchatIdle();
  });
  connect(header_, &ChatHeader::openApiKeys, this, &MainWindow::openApiKeys);
  connect(header_, &ChatHeader::openDisplaySettings, this, &MainWindow::openDisplay);
  connect(header_, &ChatHeader::openManageModels, this, &MainWindow::openManageModels);
  connect(header_, &ChatHeader::toggleSidebar, this, [this] {
    sidebarVisible_ = !sidebarVisible_;
    sidebar_->setVisible(sidebarVisible_);
    header_->setSidebarVisible(sidebarVisible_);
  });
  connect(header_, &ChatHeader::togglePanel, this, [this](int p) { togglePanel(static_cast<Panel>(p)); });

  connect(view_, &ChatView::suggestionClicked, this, [this](const QString& t) { send(t, {}); });
  connect(view_, &ChatView::openArtifactRequested, this, [this](const QString& id) {
    showPanel(Panel::Artifacts);
    artifacts_->openArtifact(id);
  });
  connect(view_, &ChatView::computerCardClicked, this, [this] { showPanel(Panel::Sandbox); });
  connect(view_, &ChatView::agentCardClicked, this, [this](const QString& id) {
    showPanel(Panel::Agents);
    if (!id.isEmpty()) agents_->focusAgent(id);
  });
  connect(view_, &ChatView::subchatSeedRequested, this, [this](const QString& sel) {
    subchat_->setVisible(true);
    view_->setSubchatOpen(true);
    subchat_->setSeed(QStringLiteral("> ") + sel.left(500) + QStringLiteral("\n\n"));
  });
  connect(view_, &ChatView::subchatOpenRequested, this, [this] {
    subchat_->setVisible(true);
    view_->setSubchatOpen(true);
  });

  connect(composer_, &Composer::sendRequested, this, [this](const QString& t, const QList<FilePart>& f) {
    send(t, f);
  });
  connect(composer_, &Composer::stopRequested, this, &MainWindow::stopRun);
  connect(composer_, &Composer::settingsChanged, this, [this](const ChatSettings& s) {
    settings_ = s;
    saveChatSettings(s);
    header_->setSettings(s);
    updateSubchatIdle();
  });

  connect(runBar_, &BackgroundRunBar::stopRequested, this, &MainWindow::stopRun);
  connect(runBar_, &BackgroundRunBar::showRequested, this, [this] {
    const QString cid = engine_->activeConversationId();
    if (!cid.isEmpty()) openConversation(cid);
  });

  connect(artifacts_, &ArtifactPanel::closeRequested, this, [this] { showPanel(Panel::None); });
  connect(sandbox_, &SandboxPanel::closeRequested, this, [this] { showPanel(Panel::None); });
  connect(agents_, &AgentsPanel::closeRequested, this, [this] { showPanel(Panel::None); });
  connect(agents_, &AgentsPanel::openArtifactRequested, this, [this](const QString& id) {
    showPanel(Panel::Artifacts);
    artifacts_->openArtifact(id);
  });

  connect(subchat_, &SubchatPanel::closeRequested, this, [this] {
    subchat_->hide();
    view_->setSubchatOpen(false);
  });  connect(subchat_, &SubchatPanel::sendRequested, this, [this](const QString& t) {
    ChatSettings s = settings_;
    s.tools.clear();
    QVector<ChatMessage> msgs;
    ChatMessage user;
    user.id = newId(8);
    user.role = QStringLiteral("user");
    user.createdAt = nowMs();
    MessagePart p;
    p.kind = MessagePart::Text;
    p.text.text = t;
    user.parts.push_back(p);
    msgs.push_back(user);
    subchat_->view()->beginAssistant();
    subBusy_ = true;
    subchat_->setBusy(true);
    subEngine_->start(msgs, s, QStringLiteral("subchat"));
  });
  connect(subchat_, &SubchatPanel::stopRequested, this, [this] { subEngine_->stop(); });

  subchat_->view()->setDisplay(display_);

  conversations_ = DataStore::listConversations();
  if (conversations_.isEmpty()) newChat();
  else openConversation(conversations_.first().id);
  refreshSidebar();
  header_->setSettings(settings_);
  header_->setKeyReady(true);
  updateSubchatIdle();
}

void MainWindow::applyTheme() {
  QFile f(QStringLiteral(":/theme.qss"));
  if (f.open(QIODevice::ReadOnly)) setStyleSheet(QString::fromUtf8(f.readAll()));
}

void MainWindow::refreshSidebar() {
  sidebar_->setConversations(conversations_, activeId_);
  sidebar_->setRunConversation(engine_->activeConversationId());
  header_->setTitle([this] {
    for (const Conversation& c : conversations_)
      if (c.id == activeId_) return c.title;
    return QStringLiteral("New chat");
  }());
}

void MainWindow::openConversation(const QString& id) {
  if (engine_->isActive() && engine_->activeConversationId() != id && !activeId_.isEmpty()) {
    saveActiveConversation();
  }
  Conversation c = DataStore::getConversation(id);
  if (c.id.isEmpty()) return;
  activeId_ = id;
  settings_.provider = c.provider.isEmpty() ? settings_.provider : c.provider;
  settings_.model = c.model.isEmpty() ? settings_.model : c.model;
  header_->setSettings(settings_);
  composer_->setSettings(settings_);
  replay(c);
  updateRunBar();
  refreshSidebar();
}

void MainWindow::updateRunBar() {
  const QString runCid = engine_->activeConversationId();
  if (engine_->isActive() && !runCid.isEmpty() && runCid != activeId_) {
    const Conversation c = DataStore::getConversation(runCid);
    const QString title = c.title.isEmpty() ? QStringLiteral("Chat") : c.title;
    const QString model = modelLabel(c.provider.isEmpty() ? settings_.provider : c.provider,
                                     c.model.isEmpty() ? settings_.model : c.model);
    runBar_->showRun(title, model, engine_->summary().startedAt);
  } else {
    runBar_->hideRun();
  }
}

void MainWindow::updateSubchatIdle() {
  if (subBusy_) return;
  subchat_->setStatus(QStringLiteral("shared context · ") +
                      modelLabel(settings_.provider, settings_.model));
}

void MainWindow::newChat() {
  Conversation c;
  c.id = newId(10);
  c.title = QStringLiteral("New chat");
  c.createdAt = nowMs();
  c.updatedAt = c.createdAt;
  c.provider = settings_.provider;
  c.model = settings_.model;
  DataStore::saveConversation(c);
  conversations_ = DataStore::listConversations();
  activeId_ = c.id;
  view_->clear();
  view_->showSuggestions(true);
  composer_->clearInput();
  refreshSidebar();
}

void MainWindow::replay(const Conversation& c) {
  view_->clear();
  if (c.messages.isEmpty()) {
    view_->showSuggestions(true);
    return;
  }
  for (const ChatMessage& m : c.messages) view_->appendMessage(m);
  view_->showSuggestions(false);
}

void MainWindow::saveActiveConversation() {
  if (activeId_.isEmpty()) return;
  Conversation c = DataStore::getConversation(activeId_);
  if (c.id.isEmpty()) return;
  c.provider = settings_.provider;
  c.model = settings_.model;
  c.updatedAt = nowMs();
  DataStore::saveConversation(c);
  conversations_ = DataStore::listConversations();
}

void MainWindow::send(const QString& text, const QList<FilePart>& files) {
  if (activeId_.isEmpty()) newChat();
  if (engine_->isActive()) {
    stopRun();
    return;
  }
  Conversation c = DataStore::getConversation(activeId_);
  ChatMessage user;
  user.id = newId(8);
  user.role = QStringLiteral("user");
  user.createdAt = nowMs();
  bool any = false;
  if (!text.isEmpty()) {
    MessagePart p;
    p.kind = MessagePart::Text;
    p.text.text = text;
    user.parts.push_back(p);
    any = true;
  }
  for (const FilePart& f : files) {
    MessagePart p;
    p.kind = MessagePart::File;
    p.file = f;
    user.parts.push_back(p);
    any = true;
  }
  if (!any) return;

  c.messages.push_back(user);
  if (c.title == QStringLiteral("New chat") && !text.isEmpty()) c.title = text.left(48);
  c.updatedAt = nowMs();
  c.provider = settings_.provider;
  c.model = settings_.model;
  DataStore::saveConversation(c);
  conversations_ = DataStore::listConversations();

  view_->appendMessage(user);
  view_->showSuggestions(false);
  composer_->clearInput();
  busy_ = true;
  composer_->setBusy(true);
  header_->setActiveRun(true);
  view_->beginAssistant();
  streamingAssistant_ = true;
  engine_->start(c.messages, settings_, c.id);
  updateRunBar();
  refreshSidebar();
}

void MainWindow::stopRun() { engine_->stop(); }

void MainWindow::wireEngine(ChatEngine* engine, bool isMain) {
  if (isMain) {
    connect(engine, &ChatEngine::statusChanged, this,
            [this](const QString& s, const QString& d) { header_->setStatus(s, d); });
    connect(engine, &ChatEngine::textDelta, this, [this](const QString& d) {
      view_->appendAssistantText(d);
    });
    connect(engine, &ChatEngine::reasoningDelta, this, [this](const QString& d) {
      view_->appendAssistantReasoning(d);
    });
    connect(engine, &ChatEngine::toolStarted, this,
            [this](const QString& id, const QString& n, const QJsonObject& in) {
              view_->addToolCard(id, n, in);
            });
    connect(engine, &ChatEngine::toolFinished, this,
            [this](const QString& id, const QString&, const QJsonValue& out) {
              view_->finishToolCard(id, out);
            });
    connect(engine, &ChatEngine::assistantMessageReady, this, [this](const ChatMessage& m) {
      if (streamingAssistant_) {
        view_->finalizeAssistant(m);
        streamingAssistant_ = false;
      } else {
        view_->appendMessage(m);
      }
      const QString runCid = engine_->activeConversationId();
      Conversation target = DataStore::getConversation(runCid.isEmpty() ? activeId_ : runCid);
      target.messages.push_back(m);
      target.updatedAt = nowMs();
      DataStore::saveConversation(target);
      conversations_ = DataStore::listConversations();
      refreshSidebar();
    });
    connect(engine, &ChatEngine::snapshot, this,
            [this](const QVector<ChatMessage>& msgs, const QString& cid) {
              Conversation c = DataStore::getConversation(cid);
              if (c.id.isEmpty()) return;
              c.messages = msgs;
              c.updatedAt = nowMs();
              c.provider = settings_.provider;
              c.model = settings_.model;
              DataStore::saveConversation(c);
              conversations_ = DataStore::listConversations();
              refreshSidebar();
            });
    connect(engine, &ChatEngine::finished, this, &MainWindow::onEngineFinished);
  } else {
    connect(engine, &ChatEngine::textDelta, this,
            [this](const QString& d) { subchat_->view()->appendAssistantText(d); });
    connect(engine, &ChatEngine::reasoningDelta, this,
            [this](const QString& d) { subchat_->view()->appendAssistantReasoning(d); });
    connect(engine, &ChatEngine::assistantMessageReady, this, [this](const ChatMessage& m) {
      subchat_->view()->finalizeAssistant(m);
      subBusy_ = false;
      subchat_->setBusy(false);
    });
    connect(engine, &ChatEngine::finished, this, [this](bool, const QString&) {
      subBusy_ = false;
      subchat_->setBusy(false);
      updateSubchatIdle();
    });
    connect(engine, &ChatEngine::statusChanged, this,
            [this](const QString& s, const QString& d) { subchat_->setStatus(s + QStringLiteral(" ") + d); });
  }
}

void MainWindow::onEngineFinished(bool ok, const QString& error) {
  busy_ = false;
  composer_->setBusy(false);
  header_->setActiveRun(false);
  streamingAssistant_ = false;
  if (!ok && !error.isEmpty()) header_->setStatus(QStringLiteral("error"), error);
  else header_->setStatus(QStringLiteral("idle"), {});
  conversations_ = DataStore::listConversations();
  refreshSidebar();
  updateRunBar();
}

void MainWindow::showPanel(Panel p) {
  if (p == Panel::None) {
    rightStack_->setCurrentIndex(0);
    rightHost_->hide();
    header_->setPanelActive(int(p), false);
    return;
  }
  rightHost_->show();
  rightStack_->setCurrentIndex(int(p) + 1);
  header_->setPanelActive(int(p), true);
  if (p == Panel::Artifacts) artifacts_->reload();
}

void MainWindow::togglePanel(Panel p) {
  if (rightStack_->currentIndex() == int(p) + 1 && rightHost_->isVisible())
    showPanel(Panel::None);
  else
    showPanel(p);
}

void MainWindow::openApiKeys() {
  ApiKeysDialog d(this);
  d.exec();
  header_->setKeyReady(true);
}

void MainWindow::openDisplay() {
  DisplaySettingsDialog d(this);
  if (d.exec() == QDialog::Accepted) {
    display_ = loadDisplay();
    view_->setDisplay(display_);
    composer_->setDisplay(display_);
    if (subchat_ && subchat_->view()) subchat_->view()->setDisplay(display_);
    replay(DataStore::getConversation(activeId_));
  }
}

void MainWindow::openManageModels() {
  ManageModelsDialog d(this);
  d.exec();
}

void MainWindow::openSkills() {
  SkillsDialog d(this);
  d.exec();
}

void MainWindow::openConnections() {
  ConnectionsDialog d(this);
  d.exec();
  McpRegistry::instance().reconnectAll();
}

void MainWindow::openSearchProviders() {
  SearchProvidersDialog d(this);
  d.exec();
}

void MainWindow::closeEvent(QCloseEvent* e) {
  if (engine_->isActive()) engine_->stop();
  saveActiveConversation();
  QMainWindow::closeEvent(e);
}

}  // namespace omnia
