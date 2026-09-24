#include "sandboxpanel.h"

#include <QHBoxLayout>
#include <QHideEvent>
#include <QIcon>
#include <QInputDialog>
#include <QMouseEvent>
#include <QScrollArea>
#include <QShowEvent>
#include <QSplitter>
#include <QTextEdit>
#include <QVBoxLayout>

#include "core/chromium.h"
#include "core/sandbox.h"
#include "ui/icons.h"

namespace omnia {

static QWidget* sandboxHeaderTile(const QString& name, const QString& bg = QStringLiteral("#24d9966a")) {
  auto* tile = new QFrame();
  auto* l = new QHBoxLayout(tile);
  l->setContentsMargins(0, 0, 0, 0);
  l->setAlignment(Qt::AlignCenter);
  auto* ic = new QLabel();
  ic->setPixmap(icon(name, QColor(QStringLiteral("#6ea8dc"))).pixmap(14, 14));
  l->addWidget(ic);
  tile->setFixedSize(28, 28);
  tile->setStyleSheet(QStringLiteral("background-color:%1; border-radius:8px;").arg(bg));
  return tile;
}

SandboxPanel::SandboxPanel(QWidget* parent) : QFrame(parent) {
  setObjectName(QStringLiteral("panel"));
  auto* root = new QVBoxLayout(this);
  root->setContentsMargins(0, 0, 0, 0);
  root->setSpacing(0);

  auto* head = new QFrame();
  head->setFixedHeight(56);
  head->setStyleSheet(QStringLiteral("border-bottom:1px solid #383634; background-color:#1a1918;"));
  auto* hr = new QHBoxLayout(head);
  hr->setContentsMargins(12, 0, 12, 0);
  hr->setSpacing(10);
  hr->addWidget(sandboxHeaderTile(QStringLiteral("monitor"), QStringLiteral("#1f6ea8dc")));
  auto* title = new QLabel(QStringLiteral("Chromium"));
  title->setStyleSheet(
      QStringLiteral("font-size:14px; font-weight:600; color:#e8e6e2; background:transparent;"));
  hr->addWidget(title, 1);
  statusBadge_ = new QLabel(QStringLiteral("checking"));
  statusBadge_->setProperty("badge", true);
  hr->addWidget(statusBadge_);
  auto* closeBtn = new QPushButton();
  closeBtn->setFixedSize(32, 32);
  closeBtn->setCursor(Qt::PointingHandCursor);
  closeBtn->setProperty("iconBtn", true);
  closeBtn->setIcon(icon(QStringLiteral("x")));
  closeBtn->setIconSize(QSize(16, 16));
  connect(closeBtn, &QPushButton::clicked, this, &SandboxPanel::closeRequested);
  hr->addWidget(closeBtn);
  root->addWidget(head);

  auto* bodyPad = new QWidget();
  auto* bp = new QVBoxLayout(bodyPad);
  bp->setContentsMargins(12, 10, 12, 12);
  bp->setSpacing(0);
  tabs_ = new QTabWidget();
  bp->addWidget(tabs_, 1);
  root->addWidget(bodyPad, 1);

  // ---- Computer tab ----
  auto* computer = new QWidget();
  auto* cl = new QVBoxLayout(computer);
  cl->setContentsMargins(0, 4, 0, 0);
  cl->setSpacing(6);

  auto* ctl = new QHBoxLayout();
  controlBadge_ = new QLabel("Model driving");
  controlBadge_->setStyleSheet(
      "background-color:#22211f; border:1px solid #35332f; border-radius:8px; padding:4px 8px;");
  takeBtn_ = new QPushButton("Take control");
  takeBtn_->setProperty("accent", true);
  auto* reloadBtn = new QPushButton();
  reloadBtn->setFixedSize(32, 32);
  reloadBtn->setCursor(Qt::PointingHandCursor);
  reloadBtn->setProperty("iconBtn", true);
  reloadBtn->setToolTip(QStringLiteral("Reload page"));
  reloadBtn->setIcon(icon(QStringLiteral("rotate-cw")));
  reloadBtn->setIconSize(QSize(15, 15));
  fullBtn_ = new QPushButton();
  fullBtn_->setFixedSize(32, 32);
  fullBtn_->setCursor(Qt::PointingHandCursor);
  fullBtn_->setProperty("iconBtn", true);
  fullBtn_->setToolTip(QStringLiteral("Toggle fullscreen"));
  fullBtn_->setIcon(icon(QStringLiteral("maximize-2")));
  fullBtn_->setIconSize(QSize(15, 15));
  connect(takeBtn_, &QPushButton::clicked, this, [this] {
    ChromiumService& c = ChromiumService::instance();
    const Control next = userDriving_ ? Control::Model : Control::User;
    if (!userDriving_ && !c.ready()) {
      ensureBrowser();
      if (!c.ready()) return;
    }
    c.setControl(next);
    userDriving_ = (next == Control::User);
    updateControlUi();
    refreshShot();
  });
  connect(reloadBtn, &QPushButton::clicked, this, [this] {
    ChromiumService::instance().nav("user", "reload");
    refreshShot();
  });
  connect(fullBtn_, &QPushButton::clicked, this, &SandboxPanel::toggleFullscreen);
  ctl->addWidget(controlBadge_);
  ctl->addStretch(1);
  ctl->addWidget(takeBtn_);
  ctl->addWidget(reloadBtn);
  ctl->addWidget(fullBtn_);
  cl->addLayout(ctl);

  browserChrome_ = new QWidget();
  auto* chrome = new QHBoxLayout(browserChrome_);
  chrome->setContentsMargins(0, 0, 0, 0);
  chrome->setSpacing(6);
  auto* backBtn = new QPushButton();
  backBtn->setFixedSize(32, 32);
  backBtn->setCursor(Qt::PointingHandCursor);
  backBtn->setProperty("iconBtn", true);
  backBtn->setToolTip(QStringLiteral("Back"));
  backBtn->setIcon(icon(QStringLiteral("chevron-left")));
  backBtn->setIconSize(QSize(16, 16));
  auto* fwdBtn = new QPushButton();
  fwdBtn->setFixedSize(32, 32);
  fwdBtn->setCursor(Qt::PointingHandCursor);
  fwdBtn->setProperty("iconBtn", true);
  fwdBtn->setToolTip(QStringLiteral("Forward"));
  fwdBtn->setIcon(icon(QStringLiteral("chevron-right")));
  fwdBtn->setIconSize(QSize(16, 16));
  urlBar_ = new QLineEdit();
  urlBar_->setPlaceholderText("Enter URL or search text…");
  auto* goBtn = new QPushButton("Go");
  goBtn->setProperty("accent", true);
  urlTitle_ = new QLabel();
  urlTitle_->setProperty("muted", true);
  connect(backBtn, &QPushButton::clicked, this, [this] {
    ChromiumService::instance().nav("user", "back");
    refreshShot();
  });
  connect(fwdBtn, &QPushButton::clicked, this, [this] {
    ChromiumService::instance().nav("user", "forward");
    refreshShot();
  });
  connect(goBtn, &QPushButton::clicked, this, &SandboxPanel::gotoUrl);
  connect(urlBar_, &QLineEdit::returnPressed, this, &SandboxPanel::gotoUrl);
  chrome->addWidget(backBtn);
  chrome->addWidget(fwdBtn);
  chrome->addWidget(urlBar_, 1);
  chrome->addWidget(goBtn);
  chrome->addWidget(urlTitle_);
  cl->addWidget(browserChrome_);

  auto* driveRow = new QHBoxLayout();
  typeBar_ = new QLineEdit();
  typeBar_->setPlaceholderText("Type into the page…");
  auto* typeBtn = new QPushButton("Type");
  auto* enterBtn = new QPushButton("Type+Enter");
  auto* upBtn = new QPushButton("Scroll ↑");
  auto* downBtn = new QPushButton("Scroll ↓");
  auto* startBtn = new QPushButton("Start browser");
  connect(typeBtn, &QPushButton::clicked, this, &SandboxPanel::sendLine);
  connect(enterBtn, &QPushButton::clicked, this, [this] {
    ChromiumService::instance().typeText("user", typeBar_->text(), true);
    typeBar_->clear();
    refreshShot();
  });
  connect(upBtn, &QPushButton::clicked, this, [this] {
    ChromiumService::instance().scroll("user", "up");
    refreshShot();
  });
  connect(downBtn, &QPushButton::clicked, this, [this] {
    ChromiumService::instance().scroll("user", "down");
    refreshShot();
  });
  connect(startBtn, &QPushButton::clicked, this, &SandboxPanel::ensureBrowser);
  driveRow->addWidget(typeBar_, 1);
  driveRow->addWidget(typeBtn);
  driveRow->addWidget(enterBtn);
  driveRow->addWidget(upBtn);
  driveRow->addWidget(downBtn);
  driveRow->addWidget(startBtn);
  cl->addLayout(driveRow);

  shot_ = new QLabel("Browser not started. Click Start browser.");
  shot_->setMinimumSize(320, 200);
  shot_->setAlignment(Qt::AlignCenter);
  shot_->setStyleSheet(
      "background-color:#0b0b0a; border:1px solid #35332f; border-radius:10px;");
  shot_->setSizePolicy(QSizePolicy::Expanding, QSizePolicy::Expanding);
  shot_->setScaledContents(false);
  shot_->installEventFilter(this);
  cl->addWidget(shot_, 1);

  filmstrip_ = new QListWidget();
  filmstrip_->setFixedHeight(74);
  filmstrip_->setFlow(QListView::LeftToRight);
  filmstrip_->setWrapping(false);
  filmstrip_->setHorizontalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
  filmstrip_->setIconSize(QSize(64, 40));
  connect(filmstrip_, &QListWidget::itemClicked, this, [this](QListWidgetItem* item) {
    const QString shot = item->data(Qt::UserRole).toString();
    if (shot.isEmpty()) return;
    const QByteArray bytes = QByteArray::fromBase64(
        shot.startsWith("data:") ? shot.mid(shot.indexOf(',') + 1).toLatin1() : shot.toLatin1());
    applyShot(bytes);
    urlTitle_->setText(item->toolTip().section('\n', 0, 0));
  });
  cl->addWidget(new QLabel("Timeline"));
  cl->addWidget(filmstrip_);

  tabs_->addTab(computer, "Computer");

  // ---- Agent sandboxes tab ----
  auto* sandboxes = new QWidget();
  auto* sl = new QVBoxLayout(sandboxes);
  sl->setContentsMargins(0, 4, 0, 0);
  sl->setSpacing(6);
  healthLabel_ = new QLabel("Checking…");
  healthLabel_->setProperty("muted", true);
  auto* refreshHealthBtn = new QPushButton("Refresh health");
  connect(refreshHealthBtn, &QPushButton::clicked, this, &SandboxPanel::refreshHealth);
  auto* headRow = hr;
  Q_UNUSED(headRow);
  auto* healthRow = new QHBoxLayout();
  healthRow->addWidget(healthLabel_, 1);
  healthRow->addWidget(refreshHealthBtn);
  sl->addLayout(healthRow);

  auto* spawnRow = new QHBoxLayout();
  labelBar_ = new QLineEdit();
  labelBar_->setPlaceholderText("Sandbox label");
  auto* spawnBtn = new QPushButton("Create sandbox");
  spawnBtn->setProperty("accent", true);
  connect(spawnBtn, &QPushButton::clicked, this, &SandboxPanel::spawnSandbox);
  spawnRow->addWidget(labelBar_, 1);
  spawnRow->addWidget(spawnBtn);
  sl->addLayout(spawnRow);

  auto* sbody = new QHBoxLayout();
  sandboxList_ = new QListWidget();
  sandboxList_->setMaximumWidth(240);
  connect(sandboxList_, &QListWidget::itemSelectionChanged, this,
          [this] { refreshSandboxList(); });
  sbody->addWidget(sandboxList_);

  auto* side = new QVBoxLayout();
  auto* btns = new QHBoxLayout();
  auto* startS = new QPushButton("Start");
  auto* killS = new QPushButton("Kill");
  auto* delS = new QPushButton("Delete");
  delS->setProperty("danger", true);
  connect(startS, &QPushButton::clicked, this, &SandboxPanel::startSelected);
  connect(killS, &QPushButton::clicked, this, &SandboxPanel::killSelected);
  connect(delS, &QPushButton::clicked, this, &SandboxPanel::deleteSelected);
  btns->addWidget(startS);
  btns->addWidget(killS);
  btns->addWidget(delS);
  side->addLayout(btns);

  execBar_ = new QLineEdit();
  execBar_->setPlaceholderText("Command to run in selected sandbox…");
  auto* runBtn = new QPushButton("Run");
  connect(runBtn, &QPushButton::clicked, this, &SandboxPanel::runExec);
  connect(execBar_, &QLineEdit::returnPressed, this, &SandboxPanel::runExec);
  side->addWidget(execBar_);
  execOut_ = new QTextEdit();
  execOut_->setReadOnly(true);
  execOut_->setFontFamily("monospace");
  side->addWidget(execOut_, 1);
  sbody->addLayout(side, 1);
  sl->addLayout(sbody, 1);
  tabs_->addTab(sandboxes, "Agent sandboxes");

  connect(&ChromiumService::instance(), &ChromiumService::timelineChanged, this,
          &SandboxPanel::refreshTimeline);
  connect(&ChromiumService::instance(), &ChromiumService::controlChanged, this,
          &SandboxPanel::updateControlUi);
  connect(&SandboxService::instance(), &SandboxService::agentEvent, this,
          [this](const QString&, const QJsonObject&) { refreshSandboxList(); });

  shotTimer_ = new QTimer(this);
  shotTimer_->setInterval(2500);
  connect(shotTimer_, &QTimer::timeout, this, &SandboxPanel::refreshShot);

  timelineTimer_ = new QTimer(this);
  timelineTimer_->setInterval(4000);
  connect(timelineTimer_, &QTimer::timeout, this, &SandboxPanel::refreshTimeline);

  userDriving_ = ChromiumService::instance().control() == Control::User;
  updateControlUi();
  refreshHealth();
  refreshSandboxList();
  refreshTimeline();
}

void SandboxPanel::updateControlUi() {
  const bool user = ChromiumService::instance().control() == Control::User;
  userDriving_ = user;
  controlBadge_->setText(user ? "You are driving (click the screenshot)" : "Model driving");
  takeBtn_->setText(user ? "Give control back" : "Take control");
  typeBar_->setEnabled(user);
}

void SandboxPanel::ensureBrowser() {
  QString err;
  if (!ChromiumService::instance().ensure(&err)) {
    shot_->setText("Failed to start browser:\n" + err);
    return;
  }
  refreshShot();
}

void SandboxPanel::gotoUrl() {
  const QString t = urlBar_->text().trimmed();
  if (t.isEmpty()) return;
  const bool looksUrl = t.contains("://") || (t.contains('.') && !t.contains(' '));
  if (looksUrl) {
    ChromiumResult r = ChromiumService::instance().navigate("user", t);
    if (!r.ok) {
      shot_->setText(r.error);
      return;
    }
    urlBar_->setText(r.url);
    urlTitle_->setText(r.title);
    if (!r.image.isEmpty()) applyShot(QByteArray::fromBase64(r.image.toUtf8()));
  } else {
    const ChromiumSearchOutcome o = ChromiumService::instance().search("user", t);
    urlBar_->setText("search: " + t);
    urlTitle_->setText(o.engine + " · " + t + " · " + QString::number(o.results.size()) + " results");
    if (!o.image.isEmpty()) applyShot(QByteArray::fromBase64(o.image.toUtf8()));
  }
  refreshShot();
}

void SandboxPanel::sendLine() {
  ChromiumService::instance().typeText("user", typeBar_->text(), false);
  typeBar_->clear();
  refreshShot();
}

void SandboxPanel::refreshShot() {
  if (!ChromiumService::instance().ready()) return;
  ChromiumResult r = ChromiumService::instance().shot();
  if (r.ok && !r.image.isEmpty()) {
    applyShot(QByteArray::fromBase64(r.image.toUtf8()));
    if (!r.url.isEmpty() && !userDriving_) urlBar_->setText(r.url);
    if (!r.title.isEmpty()) urlTitle_->setText(r.title);
  } else if (!r.ok && !r.error.isEmpty()) {
    shot_->setText(r.error);
  }
}

void SandboxPanel::applyShot(const QByteArray& png) {
  QPixmap pm;
  if (!pm.loadFromData(png, "PNG")) return;
  lastPpm_ = pm;
  displayed_ = pm.scaled(shot_->size(), Qt::KeepAspectRatio, Qt::SmoothTransformation);
  shot_->setPixmap(displayed_);
}

void SandboxPanel::refreshTimeline() {
  const QVector<ChromiumStep> steps = ChromiumService::instance().steps();
  filmstrip_->clear();
  for (const ChromiumStep& s : steps) {
    auto* item = new QListWidgetItem(QString::number(s.i) + " · " + s.action);
    item->setData(Qt::UserRole, s.shot);
    item->setToolTip(s.actor + " · " + s.action + " " + s.detail + "\n" + s.url + "\n" + s.title);
    if (!s.shot.isEmpty()) {
      const QByteArray bytes = QByteArray::fromBase64(
          s.shot.startsWith("data:") ? s.shot.mid(s.shot.indexOf(',') + 1).toLatin1()
                                     : s.shot.toLatin1());
      QPixmap pm;
      if (pm.loadFromData(bytes)) item->setIcon(QIcon(pm));
    }
    filmstrip_->addItem(item);
  }
  if (!steps.isEmpty()) filmstrip_->setCurrentRow(int(steps.size()) - 1);
}

void SandboxPanel::onShotClick(const QPoint& pos) {
  if (!userDriving_ || lastPpm_.isNull() || displayed_.isNull()) return;
  const double sx = double(lastPpm_.width()) / double(displayed_.width());
  const double sy = double(lastPpm_.height()) / double(displayed_.height());
  const int x0 = (shot_->width() - displayed_.width()) / 2;
  const int y0 = (shot_->height() - displayed_.height()) / 2;
  const int x = int((pos.x() - x0) * sx);
  const int y = int((pos.y() - y0) * sy);
  if (x < 0 || y < 0 || x >= lastPpm_.width() || y >= lastPpm_.height()) return;
  ChromiumService::instance().click("user", x, y);
  refreshShot();
}

bool SandboxPanel::eventFilter(QObject* watched, QEvent* e) {
  if (watched == shot_ && e->type() == QEvent::MouseButtonRelease) {
    auto* me = static_cast<QMouseEvent*>(e);
    onShotClick(me->pos());
    return true;
  }
  return QFrame::eventFilter(watched, e);
}

void SandboxPanel::showEvent(QShowEvent* e) {
  QFrame::showEvent(e);
  if (shotTimer_) shotTimer_->start();
  if (timelineTimer_) timelineTimer_->start();
  refreshShot();
  refreshTimeline();
}

void SandboxPanel::hideEvent(QHideEvent* e) {
  QFrame::hideEvent(e);
  if (shotTimer_) shotTimer_->stop();
  if (timelineTimer_) timelineTimer_->stop();
}

void SandboxPanel::toggleFullscreen() {
  fullscreen_ = !fullscreen_;
  if (fullscreen_) {
    browserChrome_->setVisible(false);
    filmstrip_->setVisible(false);
    tabs_->tabBar()->setVisible(false);
    typeBar_->parentWidget()->setVisible(true);
    setStyleSheet("background-color:#000000;");
  } else {
    browserChrome_->setVisible(true);
    filmstrip_->setVisible(true);
    tabs_->tabBar()->setVisible(true);
    setStyleSheet("");
  }
}

void SandboxPanel::refreshHealth() {
  const SandboxHealth h = SandboxService::instance().health();
  healthLabel_->setText(QString("docker: %1 · image: %2 · active: %3 · %4")
                            .arg(h.docker ? "yes" : "no")
                            .arg(h.images.contains("omnia-sandbox:latest") ? "ready" : "missing")
                            .arg(h.activeContainers)
                            .arg(h.ok ? "ok" : "degraded"));
  const bool online = h.docker && h.ok;
  statusBadge_->setText(online ? QStringLiteral("online") : QStringLiteral("offline"));
  statusBadge_->setProperty("badgeSuccess", online);
  statusBadge_->setProperty("badgeDanger", !online);
  statusBadge_->setProperty("badge", false);
  statusBadge_->style()->unpolish(statusBadge_);
  statusBadge_->style()->polish(statusBadge_);
}

void SandboxPanel::refreshSandboxList() {
  const QVector<SandboxMeta> all = SandboxService::instance().listSandboxes();
  const QString cur = sandboxList_->currentItem() ? sandboxList_->currentItem()->data(Qt::UserRole).toString()
                                                  : QString();
  sandboxList_->clear();
  for (const SandboxMeta& m : all) {
    auto* item = new QListWidgetItem(m.label + " · " + m.status);
    item->setData(Qt::UserRole, m.id);
    sandboxList_->addItem(item);
    if (m.id == cur) sandboxList_->setCurrentItem(item);
  }
}

void SandboxPanel::spawnSandbox() {
  const QString label =
      labelBar_->text().isEmpty() ? QInputDialog::getText(this, "New sandbox", "Label:")
                                   : labelBar_->text();
  if (label.isEmpty()) return;
  const SandboxMeta m = SandboxService::instance().createSandbox(label, {});
  labelBar_->clear();
  refreshSandboxList();
  refreshHealth();
  execOut_->append("created " + m.id + " (" + m.label + ")");
}

void SandboxPanel::killSelected() {
  if (auto* i = sandboxList_->currentItem())
    SandboxService::instance().killSandbox(i->data(Qt::UserRole).toString());
  refreshSandboxList();
}

void SandboxPanel::startSelected() {
  if (auto* i = sandboxList_->currentItem())
    SandboxService::instance().startSandbox(i->data(Qt::UserRole).toString());
  refreshSandboxList();
}

void SandboxPanel::deleteSelected() {
  if (auto* i = sandboxList_->currentItem()) {
    SandboxService::instance().deleteSandbox(i->data(Qt::UserRole).toString());
    refreshSandboxList();
    refreshHealth();
  }
}

void SandboxPanel::runExec() {
  auto* i = sandboxList_->currentItem();
  if (!i) {
    execOut_->append("select a sandbox first");
    return;
  }
  const auto r = SandboxService::instance().exec(i->data(Qt::UserRole).toString(),
                                                 execBar_->text());
  execOut_->append("$ " + execBar_->text());
  execOut_->append(r.output);
  if (!r.stderrText.isEmpty()) execOut_->append(r.stderrText);
  execBar_->clear();
}

}  // namespace omnia
