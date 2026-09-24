#include "subchatpanel.h"

#include <QHBoxLayout>
#include <QKeyEvent>
#include <QPushButton>
#include <QVBoxLayout>

#include "core/models.h"
#include "ui/icons.h"

namespace omnia {

class InputFilter : public QObject {
 public:
  using Callback = std::function<void()>;
  InputFilter(Callback cb, QObject* parent) : QObject(parent), cb_(std::move(cb)) {}
  bool eventFilter(QObject* w, QEvent* e) override {
    if (e->type() == QEvent::KeyPress) {
      auto* ke = static_cast<QKeyEvent*>(e);
      if (ke->key() == Qt::Key_Return || ke->key() == Qt::Key_Enter) {
        if (!(ke->modifiers() & Qt::ShiftModifier)) {
          cb_();
          return true;
        }
      }
    }
    return QObject::eventFilter(w, e);
  }

 private:
  Callback cb_;
};

static QWidget* makeTile(const QString& name) {
  auto* tile = new QFrame();
  auto* l = new QHBoxLayout(tile);
  l->setContentsMargins(0, 0, 0, 0);
  l->setAlignment(Qt::AlignCenter);
  auto* ic = new QLabel();
  ic->setPixmap(icon(name, QColor(QStringLiteral("#d9966a"))).pixmap(14, 14));
  l->addWidget(ic);
  tile->setFixedSize(28, 28);
  tile->setStyleSheet(QStringLiteral("background-color:#24d9966a; border-radius:8px;"));
  return tile;
}

SubchatPanel::SubchatPanel(QWidget* parent) : QFrame(parent) {
  setObjectName(QStringLiteral("panel"));
  setMinimumWidth(320);
  setMaximumWidth(560);
  setFixedWidth(400);
  auto* root = new QVBoxLayout(this);
  root->setContentsMargins(0, 0, 0, 0);
  root->setSpacing(0);

  auto* head = new QFrame();
  head->setFixedHeight(56);
  head->setStyleSheet(QStringLiteral("border-bottom:1px solid #383634; background-color:#1a1918;"));
  auto* hr = new QHBoxLayout(head);
  hr->setContentsMargins(12, 0, 12, 0);
  hr->setSpacing(10);

  auto* iconWrap = new QWidget();
  auto* iw = new QHBoxLayout(iconWrap);
  iw->setContentsMargins(0, 0, 0, 0);
  iw->addWidget(makeTile(QStringLiteral("messages-square")));
  hr->addWidget(iconWrap);

  auto* col = new QVBoxLayout();
  col->setSpacing(1);
  col->setContentsMargins(0, 0, 0, 0);
  auto* title = new QLabel(QStringLiteral("Subchat"));
  title->setStyleSheet(
      QStringLiteral("font-size:14px; font-weight:600; color:#e8e6e2; background:transparent;"));
  status_ = new QLabel();
  status_->setStyleSheet(QStringLiteral("font-size:10.5px; color:#716c65; background:transparent;"));
  col->addWidget(title);
  col->addWidget(status_);
  hr->addLayout(col, 1);

  auto* closeBtn = new QPushButton();
  closeBtn->setFixedSize(32, 32);
  closeBtn->setCursor(Qt::PointingHandCursor);
  closeBtn->setProperty("iconBtn", true);
  closeBtn->setIcon(icon(QStringLiteral("x")));
  closeBtn->setIconSize(QSize(16, 16));
  connect(closeBtn, &QPushButton::clicked, this, &SubchatPanel::closeRequested);
  hr->addWidget(closeBtn);
  root->addWidget(head);

  empty_ = new QWidget();
  {
    auto* el = new QVBoxLayout(empty_);
    el->setContentsMargins(16, 32, 16, 32);
    el->setSpacing(8);
    el->setAlignment(Qt::AlignHCenter | Qt::AlignVCenter);
    auto* ic = new QLabel();
    ic->setPixmap(icon(QStringLiteral("messages-square"), QColor(QStringLiteral("#716c65"))).pixmap(20, 20));
    ic->setStyleSheet(QStringLiteral("background:transparent; border:none;"));
    ic->setAlignment(Qt::AlignCenter);
    auto* t = new QLabel(QStringLiteral("Ask about this chat"));
    t->setAlignment(Qt::AlignCenter);
    t->setStyleSheet(QStringLiteral(
        "font-size:13px; font-weight:500; color:#a8a29a; background:transparent;"));
    auto* d = new QLabel(QStringLiteral(
        "This side chat sees the whole main conversation — and the main "
        "chat sees what you discuss here."));
    d->setAlignment(Qt::AlignCenter);
    d->setWordWrap(true);
    d->setStyleSheet(QStringLiteral(
        "font-size:12px; line-height:1.5; color:#716c65; background:transparent;"));
    el->addWidget(ic, 0, Qt::AlignHCenter);
    el->addWidget(t, 0, Qt::AlignHCenter);
    el->addWidget(d, 0, Qt::AlignHCenter);
  }
  root->addWidget(empty_, 1);
  empty_->show();

  view_ = new ChatView();
  view_->showSuggestions(false);
  view_->setFabEnabled(false);
  root->addWidget(view_, 1);
  view_->hide();

  auto* foot = new QFrame();
  foot->setContentsMargins(12, 10, 12, 12);
  foot->setStyleSheet(QStringLiteral("border-top:1px solid #383634; background-color:#1a1918;"));
  auto* fr = new QVBoxLayout(foot);
  fr->setContentsMargins(12, 10, 12, 12);
  fr->setSpacing(6);

  auto* box = new QFrame();
  box->setStyleSheet(QStringLiteral(
      "QFrame { background-color:#262524; border:1px solid #4d4a46; border-radius:16px; }"));
  auto* bl = new QVBoxLayout(box);
  bl->setContentsMargins(6, 8, 8, 8);
  bl->setSpacing(6);

  input_ = new QPlainTextEdit();
  input_->setPlaceholderText(QStringLiteral("Ask about the main chat…"));
  input_->setMaximumHeight(90);
  input_->setFrameShape(QFrame::NoFrame);
  input_->setStyleSheet(QStringLiteral("background:transparent; border:none; color:#e8e6e2;"));
  auto send = [this] {
    if (busy_) {
      emit stopRequested();
      return;
    }
    const QString t = input_->toPlainText().trimmed();
    if (t.isEmpty()) return;
    emit sendRequested(t);
    input_->clear();
    empty_->hide();
    view_->show();
  };
  input_->installEventFilter(new InputFilter(send, input_));
  bl->addWidget(input_);

  auto* srow = new QHBoxLayout();
  srow->setAlignment(Qt::AlignRight);
  sendBtn_ = new QPushButton();
  sendBtn_->setProperty("send", true);
  sendBtn_->setFixedSize(32, 32);
  sendBtn_->setCursor(Qt::PointingHandCursor);
  sendBtn_->setIcon(icon(QStringLiteral("arrow-up"), QColor(QStringLiteral("#ffffff"))));
  sendBtn_->setIconSize(QSize(15, 15));
  connect(sendBtn_, &QPushButton::clicked, this, send);
  srow->addWidget(sendBtn_);
  bl->addLayout(srow);

  fr->addWidget(box);
  root->addWidget(foot);
}

void SubchatPanel::setBusy(bool busy) {
  busy_ = busy;
  if (busy)
    sendBtn_->setIcon(icon(QStringLiteral("square"), QColor(QStringLiteral("#ffffff"))));
  else
    sendBtn_->setIcon(icon(QStringLiteral("arrow-up"), QColor(QStringLiteral("#ffffff"))));
}

void SubchatPanel::setSeed(const QString& text) {
  input_->setPlainText(text);
  input_->setFocus();
  if (empty_) empty_->hide();
}

void SubchatPanel::setStatus(const QString& s) { status_->setText(s); }

void SubchatPanel::reset() {
  view_->clear();
  view_->showSuggestions(false);
  input_->clear();
  if (empty_) empty_->hide();
}

}  // namespace omnia
