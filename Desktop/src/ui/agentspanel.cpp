#include "agentspanel.h"

#include <QCheckBox>
#include <QHBoxLayout>
#include <QHeaderView>
#include <QJsonDocument>
#include <QLineEdit>
#include <QPushButton>
#include <QVBoxLayout>

#include "core/agents.h"
#include "core/artifacts.h"
#include "core/display.h"
#include "core/models.h"
#include "ui/icons.h"

namespace omnia {

static QWidget* agentsHeaderTile() {
  auto* tile = new QFrame();
  auto* l = new QHBoxLayout(tile);
  l->setContentsMargins(0, 0, 0, 0);
  l->setAlignment(Qt::AlignCenter);
  auto* ic = new QLabel();
  ic->setPixmap(icon(QStringLiteral("bot"), QColor(QStringLiteral("#7bc47f"))).pixmap(14, 14));
  l->addWidget(ic);
  tile->setFixedSize(28, 28);
  tile->setStyleSheet(QStringLiteral("background-color:#1f7bc47f; border-radius:8px;"));
  return tile;
}

AgentsPanel::AgentsPanel(QWidget* parent) : QFrame(parent) {
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
  hr->addWidget(agentsHeaderTile());
  auto* title = new QLabel(QStringLiteral("Agents"));
  title->setStyleSheet(
      QStringLiteral("font-size:14px; font-weight:600; color:#e8e6e2; background:transparent;"));
  hr->addWidget(title, 1);
  runningBadge_ = new QLabel();
  runningBadge_->setProperty("badgeInfo", true);
  hr->addWidget(runningBadge_);
  auto* closeBtn = new QPushButton();
  closeBtn->setFixedSize(32, 32);
  closeBtn->setCursor(Qt::PointingHandCursor);
  closeBtn->setProperty("iconBtn", true);
  closeBtn->setIcon(icon(QStringLiteral("x")));
  closeBtn->setIconSize(QSize(16, 16));
  connect(closeBtn, &QPushButton::clicked, this, &AgentsPanel::closeRequested);
  hr->addWidget(closeBtn);
  root->addWidget(head);

  auto* body = new QVBoxLayout();
  body->setContentsMargins(12, 12, 12, 12);
  body->setSpacing(8);
  root->addLayout(body, 1);

  auto* spawnRow = new QHBoxLayout();
  spawnTask_ = new QLineEdit();
  spawnTask_->setPlaceholderText(QStringLiteral("Describe a task for the agent…"));
  researchBox_ = new QCheckBox(QStringLiteral("research"));
  auto* spawnBtn = new QPushButton(QStringLiteral("Spawn"));
  spawnBtn->setProperty("accent", true);
  connect(spawnBtn, &QPushButton::clicked, this, &AgentsPanel::spawn);
  connect(spawnTask_, &QLineEdit::returnPressed, this, &AgentsPanel::spawn);
  spawnRow->addWidget(spawnTask_, 1);
  spawnRow->addWidget(researchBox_);
  spawnRow->addWidget(spawnBtn);
  body->addLayout(spawnRow);

  emptyLabel_ = new QLabel(QStringLiteral(
      "No agents yet. Ask the model to run a task, or spawn one below."));
  emptyLabel_->setAlignment(Qt::AlignCenter);
  emptyLabel_->setWordWrap(true);
  emptyLabel_->setStyleSheet(QStringLiteral(
      "font-size:13px; color:#716c65; background:transparent; padding:24px 12px;"));
  body->addWidget(emptyLabel_);

  list_ = new QListWidget();
  list_->setMaximumWidth(240);
  connect(list_, &QListWidget::itemSelectionChanged, this, [this] { refreshDetail(); });

  auto* detail = new QVBoxLayout();
  detailTitle_ = new QLabel("No agent selected");
  statusLabel_ = new QLabel();
  statusLabel_->setProperty("muted", true);
  auto* stopBtn = new QPushButton("Stop");
  stopBtn->setProperty("danger", true);
  connect(stopBtn, &QPushButton::clicked, this, &AgentsPanel::stopSelected);
  auto* row1 = new QHBoxLayout();
  row1->addWidget(detailTitle_, 1);
  row1->addWidget(statusLabel_);
  row1->addWidget(stopBtn);
  detail->addLayout(row1);

  taskLabel_ = new QPlainTextEdit();
  taskLabel_->setReadOnly(true);
  taskLabel_->setMaximumHeight(64);
  detail->addWidget(taskLabel_);

  auto* lower = new QHBoxLayout();
  logView_ = new QPlainTextEdit();
  logView_->setReadOnly(true);
  logView_->setPlaceholderText("agent log stream…");
  lower->addWidget(logView_, 3);

  auto* rightCol = new QVBoxLayout();
  shot_ = new QLabel("no screenshot");
  shot_->setMinimumHeight(160);
  shot_->setAlignment(Qt::AlignCenter);
  shot_->setStyleSheet(
      "background-color:#0b0b0a; border:1px solid #35332f; border-radius:8px;");
  shot_->setScaledContents(false);
  rightCol->addWidget(shot_);
  files_ = new QTableWidget(0, 1);
  files_->setHorizontalHeaderLabels({"output files"});
  files_->horizontalHeader()->setStretchLastSection(true);
  files_->verticalHeader()->setVisible(false);
  connect(files_, &QTableWidget::cellDoubleClicked, this, [this](int r, int) {
    emit openArtifactRequested(files_->item(r, 0)->data(Qt::UserRole).toString());
  });
  rightCol->addWidget(files_, 1);
  lower->addLayout(rightCol, 2);
  detail->addLayout(lower, 1);
  auto* listAndDetail = new QHBoxLayout();
  listAndDetail->setSpacing(10);
  listAndDetail->addWidget(list_);
  auto* detailHost = new QWidget();
  detailHost->setLayout(detail);
  listAndDetail->addWidget(detailHost, 1);
  body->addLayout(listAndDetail, 1);

  timer_ = new QTimer(this);
  timer_->setInterval(3000);
  connect(timer_, &QTimer::timeout, this, [this] {
    refreshList();
    refreshDetail();
  });
  timer_->start();

  connect(&AgentsService::instance(), &AgentsService::changed, this,
          [this](const QString& id) {
            refreshList();
            if (id == currentId_) refreshDetail();
          });
  connect(&AgentsService::instance(), &AgentsService::artifactImported, this,
          [this](const ArtifactMeta&) { refreshDetail(); });

  refreshList();
}

void AgentsPanel::refreshList() {
  const QVector<AgentMeta> all = AgentsService::instance().list();
  const QString keep = list_->currentItem() ? list_->currentItem()->data(Qt::UserRole).toString()
                                            : currentId_;
  list_->clear();
  int running = 0;
  for (const AgentMeta& a : all) {
    if (a.status == QStringLiteral("queued") || a.status == QStringLiteral("starting") ||
        a.status == QStringLiteral("running"))
      ++running;
    auto* item = new QListWidgetItem(a.label + " · " + a.status);
    item->setData(Qt::UserRole, a.id);
    list_->addItem(item);
    if (a.id == keep) list_->setCurrentItem(item);
  }
  runningBadge_->setText(QString::number(running) + QStringLiteral(" running"));
  emptyLabel_->setVisible(all.isEmpty());
}

void AgentsPanel::focusAgent(const QString& id) {
  currentId_ = id;
  for (int i = 0; i < list_->count(); ++i)
    if (list_->item(i)->data(Qt::UserRole).toString() == id) list_->setCurrentRow(i);
  refreshDetail();
}

void AgentsPanel::refreshDetail() {
  auto* item = list_->currentItem();
  const QString id = item ? item->data(Qt::UserRole).toString() : currentId_;
  if (id.isEmpty()) return;
  currentId_ = id;
  const AgentMeta a = AgentsService::instance().get(id);
  if (a.id.isEmpty()) return;
  detailTitle_->setText(a.label);
  statusLabel_->setText(a.status + (a.error.isEmpty() ? "" : " · " + a.error));
  taskLabel_->setPlainText(a.task);
  QString log;
  for (const QJsonObject& e : a.logs) log += QString::fromUtf8(QJsonDocument(e).toJson(QJsonDocument::Compact)) + "\n";
  logView_->setPlainText(log);
  if (!a.lastScreenshot.isEmpty()) {
    QPixmap pm;
    const QByteArray b = QByteArray::fromBase64(
        a.lastScreenshot.startsWith("data:") ? a.lastScreenshot.mid(a.lastScreenshot.indexOf(',') + 1).toLatin1()
                                             : a.lastScreenshot.toLatin1());
    if (pm.loadFromData(b)) shot_->setPixmap(pm.scaled(shot_->size(), Qt::KeepAspectRatio, Qt::SmoothTransformation));
  } else {
    shot_->setText("no screenshot");
  }
  files_->setRowCount(a.files.size());
  for (int i = 0; i < a.files.size(); ++i) {
    auto* cell = new QTableWidgetItem(a.files[i]);
    cell->setToolTip(a.files[i]);
    const QString base = a.files[i].split(QLatin1Char('/')).last();
    QString artifactId;
    for (const ArtifactMeta& m : listArtifacts())
      if (m.filename == base || m.url == a.files[i] || m.id == a.files[i]) {
        artifactId = m.id;
        break;
      }
    cell->setData(Qt::UserRole, artifactId);
    files_->setItem(i, 0, cell);
  }
}

void AgentsPanel::spawn() {
  const QString task = spawnTask_->text().trimmed();
  if (task.isEmpty()) return;
  ChatSettings cs = loadChatSettings();
  const AgentMeta a = AgentsService::instance().spawn(task, cs.provider, cs.model, "engine",
                                                      "agent", researchBox_->isChecked());
  spawnTask_->clear();
  refreshList();
  focusAgent(a.id);
}

void AgentsPanel::stopSelected() {
  auto* item = list_->currentItem();
  if (!item) return;
  AgentsService::instance().stop(item->data(Qt::UserRole).toString());
  refreshList();
  refreshDetail();
}

}  // namespace omnia
