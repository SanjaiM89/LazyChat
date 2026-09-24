#include "chatheader.h"

#include <QHBoxLayout>
#include <QMenu>
#include <QStyle>

#include "core/display.h"
#include "core/models.h"
#include "ui/icons.h"

namespace omnia {

static QPushButton* iconToggle(const QString& name, const QString& tip) {
  auto* b = new QPushButton();
  b->setObjectName(QStringLiteral("hdrBtn"));
  b->setCheckable(true);
  b->setToolTip(tip);
  b->setFixedSize(32, 32);
  b->setCursor(Qt::PointingHandCursor);
  b->setProperty("iconBtn", true);
  b->setIcon(icon(name));
  b->setIconSize(QSize(16, 16));
  b->setStyleSheet(QStringLiteral("QPushButton { border:none; border-radius:8px; padding:6px; }"));
  return b;
}

ChatHeader::ChatHeader(QWidget* parent) : QFrame(parent) {
  setObjectName(QStringLiteral("header"));
  setFixedHeight(56);
  auto* root = new QHBoxLayout(this);
  root->setContentsMargins(12, 0, 12, 0);
  root->setSpacing(6);

  sideBtn_ = iconToggle(QStringLiteral("panel-left"), QStringLiteral("Toggle sidebar"));
  sideBtn_->setCheckable(false);
  connect(sideBtn_, &QPushButton::clicked, this, &ChatHeader::toggleSidebar);
  root->addWidget(sideBtn_);

  titleLabel_ = new QLabel(QStringLiteral("New chat"));
  titleLabel_->setStyleSheet(
      QStringLiteral("font-size:14px; font-weight:600; color:#e8e6e2; background:transparent;"));
  titleLabel_->setMinimumWidth(0);
  root->addWidget(titleLabel_, 1);

  artBtn_ = iconToggle(QStringLiteral("file-text"), QStringLiteral("Artifacts panel"));
  connect(artBtn_, &QPushButton::clicked, this, [this] { emit togglePanel(int(Panel::Artifacts)); });
  root->addWidget(artBtn_);

  sandBtn_ = iconToggle(QStringLiteral("monitor"), QStringLiteral("Chromium panel"));
  sandBtn_->setToolTip(QStringLiteral("Chromium panel"));
  connect(sandBtn_, &QPushButton::clicked, this, [this] { emit togglePanel(int(Panel::Sandbox)); });
  root->addWidget(sandBtn_);

  agentBtn_ = iconToggle(QStringLiteral("bot"), QStringLiteral("Agents panel"));
  connect(agentBtn_, &QPushButton::clicked, this, [this] { emit togglePanel(int(Panel::Agents)); });
  root->addWidget(agentBtn_);

  auto* divider = new QFrame();
  divider->setFixedWidth(1);
  divider->setFixedHeight(20);
  divider->setStyleSheet(QStringLiteral("background-color:#383634;"));
  root->addWidget(divider);

  statusLabel_ = new QLabel();
  statusLabel_->setProperty("muted", true);
  statusLabel_->setStyleSheet(QStringLiteral("font-size:12px; color:#716c65; background:transparent;"));
  statusLabel_->hide();
  root->addWidget(statusLabel_);

  auto* displayBtn = iconToggle(QStringLiteral("settings-2"), QStringLiteral("Display settings"));
  connect(displayBtn, &QPushButton::clicked, this, &ChatHeader::openDisplaySettings);
  root->addWidget(displayBtn);

  auto* keysBtn = new QPushButton();
  keysBtn->setFixedSize(32, 32);
  keysBtn->setCursor(Qt::PointingHandCursor);
  keysBtn->setProperty("iconBtn", true);
  keysBtn->setToolTip(QStringLiteral("API keys"));
  keysBtn->setIcon(icon(QStringLiteral("key-round")));
  keysBtn->setIconSize(QSize(16, 16));
  auto* keyWrap = new QWidget();
  keyWrap->setFixedSize(32, 32);
  auto* kw = new QHBoxLayout(keyWrap);
  kw->setContentsMargins(0, 0, 0, 0);
  kw->setSpacing(0);
  kw->setAlignment(Qt::AlignCenter);
  keysBtn->setStyleSheet(QStringLiteral("border:none; background:transparent; padding:6px;"));
  kw->addWidget(keysBtn);
  keyDot_ = new QLabel(keyWrap);
  keyDot_->setProperty("statusDot", false);
  keyDot_->setFixedSize(6, 6);
  keyDot_->setGeometry(22, 4, 6, 6);
  keyDot_->raise();
  keyDot_->show();
  connect(keysBtn, &QPushButton::clicked, this, &ChatHeader::openApiKeys);
  root->addWidget(keyWrap);

  modelBtn_ = new QToolButton();
  modelBtn_->setObjectName(QStringLiteral("modelPill"));
  modelBtn_->setPopupMode(QToolButton::InstantPopup);
  modelBtn_->setToolButtonStyle(Qt::ToolButtonTextOnly);
  modelBtn_->setCursor(Qt::PointingHandCursor);
  modelBtn_->setArrowType(Qt::NoArrow);
  auto* mrow = new QHBoxLayout();
  mrow->setSpacing(4);
  mrow->setAlignment(Qt::AlignRight | Qt::AlignVCenter);
  mrow->addWidget(modelBtn_);
  root->addLayout(mrow);
}

void ChatHeader::setSettings(const ChatSettings& settings) {
  settings_ = settings;
  modelBtn_->setText(providerGlyph(settings.provider) + QStringLiteral(" ") +
                     modelLabel(settings.provider, settings.model) + QStringLiteral("  ▾"));
  rebuildMenu();
}

void ChatHeader::rebuildMenu() {
  if (QMenu* old = modelBtn_->menu()) old->deleteLater();
  auto* menu = new QMenu(modelBtn_);
  for (const ProviderConfig& p : allProviders()) {
    auto* pMenu = menu->addMenu(p.glyph + QStringLiteral(" ") + p.name);
    for (const ModelConfig& m : effectiveModels(p.id)) {
      QString name = m.name;
      if (m.liveOnly) name += QStringLiteral("  · live");
      if (m.id == settings_.model && p.id == settings_.provider) name = QStringLiteral("● ") + name;
      auto* a = pMenu->addAction(name);
      a->setToolTip(m.id + (m.liveOnly ? QStringLiteral("  (live list)") : QString()));
      connect(a, &QAction::triggered, this, [this, p, m] {
        ChatSettings s = settings_;
        s.provider = p.id;
        s.model = m.id;
        if (!m.supportsThinking) s.thinking = false;
        emit settingsChanged(s);
      });
    }
  }
  menu->addSeparator();
  auto* refresh = menu->addAction(QStringLiteral("Refresh live models…"));
  connect(refresh, &QAction::triggered, this, &ChatHeader::refreshLiveModels);
  auto* manage = menu->addAction(QStringLiteral("Manage models…"));
  connect(manage, &QAction::triggered, this, &ChatHeader::openManageModels);
  auto* keys = menu->addAction(QStringLiteral("API keys…"));
  connect(keys, &QAction::triggered, this, &ChatHeader::openApiKeys);
  modelBtn_->setMenu(menu);
}

void ChatHeader::refreshLiveModels() {
  statusLabel_->setProperty("muted", true);
  statusLabel_->setText(QStringLiteral("Refreshing models…"));
  statusLabel_->show();
  const LiveModelsOutcome out = fetchLiveModels(settings_.provider);
  if (out.ok) {
    setLiveModelIds(settings_.provider, out.ids.toList());
    statusLabel_->setText(QStringLiteral("Live model lists loaded"));
    rebuildMenu();
  } else {
    statusLabel_->setText(out.error.left(80));
  }
}

void ChatHeader::setStatus(const QString& status, const QString& detail) {
  if (status == QLatin1String("error")) {
    statusLabel_->setProperty("danger", true);
    statusLabel_->setProperty("muted", false);
    statusLabel_->setText(detail.left(80));
    statusLabel_->show();
  } else if (detail.isEmpty()) {
    statusLabel_->hide();
  } else {
    statusLabel_->setProperty("danger", false);
    statusLabel_->setProperty("muted", true);
    statusLabel_->setText(detail.left(80));
    statusLabel_->show();
  }
  statusLabel_->style()->unpolish(statusLabel_);
  statusLabel_->style()->polish(statusLabel_);
}

void ChatHeader::setActiveRun(bool active) { modelBtn_->setEnabled(!active); }

void ChatHeader::setTitle(const QString& title) {
  QString t = title.isEmpty() ? QStringLiteral("New chat") : title;
  t.replace(QLatin1Char('\n'), QLatin1Char(' '));
  titleLabel_->setText(t.simplified());
}

void ChatHeader::setPanelActive(int panel, bool active) {
  artBtn_->setChecked(panel == int(Panel::Artifacts) && active);
  sandBtn_->setChecked(panel == int(Panel::Sandbox) && active);
  agentBtn_->setChecked(panel == int(Panel::Agents) && active);
}

void ChatHeader::setSidebarVisible(bool visible) {
  sideBtn_->blockSignals(true);
  sideBtn_->setChecked(!visible);
  sideBtn_->blockSignals(false);
}

void ChatHeader::setKeyReady(bool ready) {
  keyDot_->setProperty("statusDot", ready);
  keyDot_->style()->unpolish(keyDot_);
  keyDot_->style()->polish(keyDot_);
}

}  // namespace omnia
