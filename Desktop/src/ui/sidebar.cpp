#include "sidebar.h"

#include <QDateTime>
#include <QEvent>
#include <QHBoxLayout>
#include <QLabel>
#include <QMouseEvent>
#include <QPushButton>
#include <QVBoxLayout>

#include "ui/icons.h"

namespace omnia {

bool Sidebar::eventFilter(QObject* watched, QEvent* e) {
  if (watched == list_->viewport()) {
    if (e->type() == QEvent::MouseMove || e->type() == QEvent::HoverMove) {
      auto* me = static_cast<QMouseEvent*>(e);
      QListWidgetItem* over = list_->itemAt(me->pos());
      for (int i = 0; i < list_->count(); ++i) {
        QWidget* row = list_->itemWidget(list_->item(i));
        if (!row) continue;
        auto* del = row->findChild<QPushButton*>(QStringLiteral("convDel"));
        if (!del) continue;
        const bool hot = list_->item(i) == over;
        del->setVisible(hot);
        if (!row->property("active").toBool())
          row->setStyleSheet(
              hot ? QStringLiteral(
                        "QWidget#convRow { background-color:#0dffffff; border:none; border-radius:8px; }")
                  : QStringLiteral(
                        "QWidget#convRow { background:transparent; border:none; border-radius:8px; }"));
      }
    } else if (e->type() == QEvent::Leave) {
      for (int i = 0; i < list_->count(); ++i) {
        QWidget* row = list_->itemWidget(list_->item(i));
        if (!row) continue;
        auto* del = row->findChild<QPushButton*>(QStringLiteral("convDel"));
        if (del) del->setVisible(false);
        if (!row->property("active").toBool())
          row->setStyleSheet(QStringLiteral(
              "QWidget#convRow { background:transparent; border:none; border-radius:8px; }"));
      }
    }
  }
  return QFrame::eventFilter(watched, e);
}

static QString timeAgo(qint64 ts) {
  const qint64 s = qMax<qint64>(0, (QDateTime::currentMSecsSinceEpoch() - ts) / 1000);
  if (s < 60) return QStringLiteral("just now");
  const qint64 m = s / 60;
  if (m < 60) return QString::number(m) + QStringLiteral("m ago");
  const qint64 h = m / 60;
  if (h < 24) return QString::number(h) + QStringLiteral("h ago");
  return QDateTime::fromMSecsSinceEpoch(ts).toString(QStringLiteral("MMM d"));
}

Sidebar::Sidebar(QWidget* parent) : QFrame(parent) {
  setObjectName(QStringLiteral("sidebar"));
  setFixedWidth(272);

  auto* root = new QVBoxLayout(this);
  root->setContentsMargins(16, 16, 12, 10);
  root->setSpacing(0);

  auto* brandRow = new QHBoxLayout();
  brandRow->setSpacing(10);
  auto* logo = new QLabel();
  logo->setPixmap(icon(QStringLiteral("sparkles"), QColor(QStringLiteral("#ffffff"))).pixmap(15, 15));
  logo->setFixedSize(32, 32);
  logo->setAlignment(Qt::AlignCenter);
  logo->setStyleSheet(
      QStringLiteral(
          "background:qlineargradient(x1:0,y1:0,x2:1,y2:1,"
          "stop:0 #d9966a, stop:1 #9a5a31);"
          "border-radius:12px;"));
  brandRow->addWidget(logo);
  auto* brandCol = new QVBoxLayout();
  brandCol->setSpacing(1);
  brandCol->setContentsMargins(0, 0, 0, 0);
  auto* brandTitle = new QLabel(QStringLiteral("Omnia"));
  brandTitle->setStyleSheet(
      QStringLiteral("font-size:15px; font-weight:700; letter-spacing:-0.3px; color:#e8e6e2; background:transparent;"));
  subtitle_ = new QLabel(QStringLiteral("Multi-provider workspace"));
  subtitle_->setStyleSheet(QStringLiteral("font-size:10.5px; color:#716c65; background:transparent;"));
  brandCol->addWidget(brandTitle);
  brandCol->addWidget(subtitle_);
  brandRow->addLayout(brandCol, 1);
  root->addLayout(brandRow);
  root->addSpacing(14);

  auto* newBtn = new QPushButton();
  newBtn->setObjectName(QStringLiteral("newChatBtn"));
  auto* nl = new QHBoxLayout(newBtn);
  nl->setContentsMargins(0, 0, 0, 0);
  nl->setSpacing(6);
  nl->setAlignment(Qt::AlignCenter);
  auto* plusIcon = new QLabel();
  plusIcon->setPixmap(icon(QStringLiteral("plus"), QColor(QStringLiteral("#e8e6e2"))).pixmap(15, 15));
  auto* newLabel = new QLabel(QStringLiteral("New chat"));
  newLabel->setStyleSheet(
      QStringLiteral("font-size:13.5px; font-weight:500; color:#e8e6e2; background:transparent; border:none;"));
  plusIcon->setStyleSheet(QStringLiteral("background:transparent; border:none;"));
  nl->addWidget(plusIcon);
  nl->addWidget(newLabel);
  newBtn->setCursor(Qt::PointingHandCursor);
  newBtn->setFixedHeight(36);
  newBtn->setStyleSheet(
      QStringLiteral(
          "QPushButton { background-color:#262524; border:1px solid #383634; border-radius:12px; }"
          "QPushButton:hover { border-color:#66d9966a; background-color:#2f2e2c; }"));
  connect(newBtn, &QPushButton::clicked, this, &Sidebar::newChatRequested);
  root->addWidget(newBtn);
  root->addSpacing(8);

  list_ = new QListWidget();
  list_->setSpacing(2);
  list_->setFocusPolicy(Qt::NoFocus);
  list_->setMouseTracking(true);
  list_->viewport()->setMouseTracking(true);
  list_->viewport()->installEventFilter(this);
  connect(list_, &QListWidget::itemClicked, this, [this](QListWidgetItem* item) {
    emit conversationSelected(item->data(Qt::UserRole).toString());
  });
  root->addWidget(list_, 1);

  emptyLabel_ = new QLabel(QStringLiteral("No conversations yet. Start a new chat to get going."));
  emptyLabel_->setWordWrap(true);
  emptyLabel_->setStyleSheet(QStringLiteral("font-size:12px; color:#716c65; padding:16px 12px; background:transparent;"));
  root->addWidget(emptyLabel_);
  emptyLabel_->hide();

  root->addSpacing(8);
  auto* foot = new QFrame();
  foot->setStyleSheet(QStringLiteral("border-top:1px solid #383634; background:transparent;"));
  auto* fl = new QVBoxLayout(foot);
  fl->setContentsMargins(0, 8, 0, 0);
  fl->setSpacing(2);

  auto makeFoot = [fl, this](const QString& iconName, const QString& label, void (Sidebar::*sig)()) {
    auto* b = new QPushButton();
    auto* l = new QHBoxLayout(b);
    l->setContentsMargins(12, 0, 12, 0);
    l->setSpacing(10);
    auto* ic = new QLabel();
    ic->setPixmap(icon(iconName, QColor(QStringLiteral("#d9966a"))).pixmap(15, 15));
    auto* t = new QLabel(label);
    t->setStyleSheet(
        QStringLiteral("font-size:13px; color:#a8a29a; background:transparent; border:none;"));
    ic->setStyleSheet(QStringLiteral("background:transparent; border:none;"));
    l->addWidget(ic);
    l->addWidget(t, 1);
    b->setFixedHeight(32);
    b->setCursor(Qt::PointingHandCursor);
    b->setStyleSheet(
        QStringLiteral(
            "QPushButton { background:transparent; border:none; border-radius:8px; }"
            "QPushButton:hover { background-color:#0dffffff; }"));
    connect(b, &QPushButton::clicked, this, sig);
    fl->addWidget(b);
  };
  makeFoot(QStringLiteral("book-open"), QStringLiteral("Skills"), &Sidebar::openSkills);
  makeFoot(QStringLiteral("globe"), QStringLiteral("Search providers"), &Sidebar::openSearchProviders);
  makeFoot(QStringLiteral("plug"), QStringLiteral("Connections"), &Sidebar::openConnections);
  root->addWidget(foot);
}

void Sidebar::setConversations(const QVector<Conversation>& conversations, const QString& activeId) {
  activeId_ = activeId;
  list_->blockSignals(true);
  list_->clear();
  emptyLabel_->setVisible(conversations.isEmpty());
  for (const Conversation& c : conversations) {
    QString title = c.title;
    if (title.isEmpty()) title = QStringLiteral("New chat");
    const bool running = !runCid_.isEmpty() && c.id == runCid_;
    const bool active = c.id == activeId;

    auto* row = new QWidget();
    row->setObjectName(QStringLiteral("convRow"));
    row->setProperty("active", active);
    row->setStyleSheet(        active ? QStringLiteral(
                     "QWidget#convRow { background-color:#24d9966a; border:none; border-radius:8px; }")
               : QStringLiteral(
                     "QWidget#convRow { background:transparent; border:none; border-radius:8px; }"));
    row->installEventFilter(this);
    auto* rl = new QHBoxLayout(row);
    rl->setContentsMargins(12, 10, 12, 10);
    rl->setSpacing(10);

    auto* iconBox = new QWidget();
    iconBox->setFixedSize(14, 14);
    auto* ib = new QHBoxLayout(iconBox);
    ib->setContentsMargins(0, 0, 0, 0);
    ib->setAlignment(Qt::AlignCenter);
    if (running) {
      auto* dot = new QLabel();
      dot->setFixedSize(6, 6);
      dot->setStyleSheet(QStringLiteral(
          "background-color:#d9966a; border-radius:3px;"));
      ib->addWidget(dot, 0, Qt::AlignCenter);
    } else {
      auto* ic = new QLabel();
      ic->setPixmap(icon(QStringLiteral("message-square"),
                          QColor(active ? QStringLiteral("#d9966a") : QStringLiteral("#716c65")))
                        .pixmap(14, 14));
      ib->addWidget(ic);
    }
    rl->addWidget(iconBox);

    auto* col = new QVBoxLayout();
    col->setSpacing(1);
    col->setContentsMargins(0, 0, 0, 0);
    auto* t = new QLabel(title);
    t->setStyleSheet(QStringLiteral(
        "font-size:13px; font-weight:500; color:#e8e6e2; background:transparent;"));
    auto* sub = new QLabel(running ? QStringLiteral("Generating…") : timeAgo(c.updatedAt));
    sub->setStyleSheet(QStringLiteral(
        "font-size:10.5px; color:%1; background:transparent;")
                           .arg(running ? QStringLiteral("#d9966a") : QStringLiteral("#716c65")));
    col->addWidget(t);
    col->addWidget(sub);
    rl->addLayout(col, 1);

    auto* del = new QPushButton();
    del->setObjectName(QStringLiteral("convDel"));
    del->setFixedSize(24, 24);
    del->setCursor(Qt::PointingHandCursor);
    del->setProperty("iconBtn", true);
    del->setIcon(icon(QStringLiteral("trash-2"), QColor(QStringLiteral("#e07870"))));
    del->setIconSize(QSize(13, 13));
    del->setToolTip(QStringLiteral("Delete conversation"));
    del->setStyleSheet(QStringLiteral(
        "QPushButton { border:none; background:transparent; border-radius:6px; padding:4px; }"
        "QPushButton:hover { background-color:#1fe07870; }"));
    del->setVisible(false);
    const QString id = c.id;
    connect(del, &QPushButton::clicked, this, [this, id] { emit deleteConversationRequested(id); });
    rl->addWidget(del, 0, Qt::AlignVCenter);

    auto* item = new QListWidgetItem();
    item->setData(Qt::UserRole, c.id);
    item->setSizeHint(QSize(0, 52));
    list_->addItem(item);
    list_->setItemWidget(item, row);
    if (active) list_->setCurrentItem(item);
  }
  list_->blockSignals(false);
}

void Sidebar::setRunConversation(const QString& conversationId) {
  if (runCid_ == conversationId) return;
  runCid_ = conversationId;
}

void Sidebar::setModelSubtitle(const QString& text) { subtitle_->setText(text); }

}  // namespace omnia
