#include "composer.h"

#include <QClipboard>
#include <QDragEnterEvent>
#include <QDropEvent>
#include <QFile>
#include <QFileDialog>
#include <QGuiApplication>
#include <QHBoxLayout>
#include <QKeyEvent>
#include <QMenu>
#include <QMimeData>
#include <QScrollBar>
#include <QVBoxLayout>

#include "core/artifacts.h"
#include "core/display.h"
#include "core/models.h"
#include "ui/icons.h"

namespace omnia {

Composer::Composer(QWidget* parent) : QFrame(parent) {
  setObjectName(QStringLiteral("composer"));
  setAcceptDrops(true);
  auto* root = new QVBoxLayout(this);
  root->setContentsMargins(24, 8, 24, 8);
  root->setSpacing(6);

  chips_ = new QWidget();
  auto* chipLay = new QHBoxLayout(chips_);
  chipLay->setContentsMargins(0, 0, 0, 0);
  chipLay->setSpacing(6);
  chips_->setLayout(chipLay);
  chips_->setVisible(false);
  root->addWidget(chips_);

  box_ = new QFrame();
  box_->setObjectName(QStringLiteral("composerBox"));
  box_->setStyleSheet(
      QStringLiteral("#composerBox { background-color:#262524; border:1px solid #4d4a46;"
                     " border-radius:22px; }"));
  auto* bl = new QVBoxLayout(box_);
  bl->setContentsMargins(6, 8, 8, 8);
  bl->setSpacing(6);

  input_ = new QPlainTextEdit();
  input_->setPlaceholderText(QStringLiteral("Ask anything… (drop files to attach)"));
  input_->setMaximumHeight(200);
  input_->setSizePolicy(QSizePolicy::Expanding, QSizePolicy::Fixed);
  input_->setFixedHeight(40);
  input_->setFrameShape(QFrame::NoFrame);
  input_->setStyleSheet(QStringLiteral("background:transparent; border:none; color:#e8e6e2;"));
  connect(input_, &QPlainTextEdit::textChanged, this, [this] {
    input_->document()->adjustSize();
    const int h = int(input_->document()->size().height()) + 8;
    input_->setFixedHeight(qBound(40, h, 200));
  });
  input_->installEventFilter(this);
  bl->addWidget(input_);

  auto* tools = new QHBoxLayout();
  tools->setSpacing(2);

  auto* attach = new QPushButton();
  attach->setFixedSize(32, 32);
  attach->setCursor(Qt::PointingHandCursor);
  attach->setProperty("iconBtn", true);
  attach->setToolTip(QStringLiteral("Attach a file"));
  attach->setIcon(icon(QStringLiteral("paperclip")));
  attach->setIconSize(QSize(16, 16));
  connect(attach, &QPushButton::clicked, this, [this] {
    const QStringList paths = QFileDialog::getOpenFileNames(this, QStringLiteral("Attach files"));
    attachFiles(paths);
  });
  tools->addWidget(attach);

  auto stateIcon = [](const QString& name, const QColor& on) {
    QIcon ic;
    ic.addPixmap(icon(name, QColor(QStringLiteral("#716c65"))).pixmap(14, 14), QIcon::Normal,
                 QIcon::Off);
    ic.addPixmap(icon(name, on).pixmap(14, 14), QIcon::Normal, QIcon::On);
    return ic;
  };

  auto makeToggle = [this, &tools, &stateIcon](const QString& id, const QString& label,
                                               const QString& ic) {
    auto* b = new QPushButton(label);
    b->setCheckable(true);
    b->setProperty("tool", true);
    b->setCursor(Qt::PointingHandCursor);
    b->setIcon(stateIcon(ic, QColor(QStringLiteral("#d9966a"))));
    b->setIconSize(QSize(14, 14));
    connect(b, &QPushButton::toggled, this, [this, id](bool on) {
      ChatSettings s = settings_;
      if (on && !s.tools.contains(id)) s.tools.append(id);
      if (!on) s.tools.removeAll(id);
      settings_ = s;
      refreshToggles();
      emit settingsChanged(s);
    });
    toggles_.insert(id, b);
    tools->addWidget(b);
  };
  makeToggle(QStringLiteral("webSearch"), QStringLiteral("Search"), QStringLiteral("globe"));
  makeToggle(QStringLiteral("createArtifact"), QStringLiteral("Artifacts"), QStringLiteral("file-text"));
  makeToggle(QStringLiteral("runAgentTask"), QStringLiteral("Agents"), QStringLiteral("bot"));
  makeToggle(QStringLiteral("computerUse"), QStringLiteral("Computer"), QStringLiteral("monitor"));

  auto* thinking = new QPushButton(QStringLiteral("Thinking"));
  thinking->setCheckable(true);
  thinking->setProperty("thinking", true);
  thinking->setCursor(Qt::PointingHandCursor);
  thinking->setObjectName(QStringLiteral("thinkingToggle"));
  thinking->setToolTip(QStringLiteral("Turn on extended thinking"));
  thinking->setIcon(stateIcon(QStringLiteral("brain"), QColor(QStringLiteral("#6ea8dc"))));
  thinking->setIconSize(QSize(14, 14));
  connect(thinking, &QPushButton::toggled, this, [this](bool on) {
    ChatSettings s = settings_;
    s.thinking = on;
    settings_ = s;
    emit settingsChanged(s);
  });
  toggles_.insert(QStringLiteral("__thinking"), thinking);
  tools->addWidget(thinking);

  tools->addStretch(1);

  auto* right = new QHBoxLayout();
  right->setSpacing(6);
  right->setAlignment(Qt::AlignRight | Qt::AlignVCenter);

  modelPill_ = new QPushButton();
  modelPill_->setObjectName(QStringLiteral("modelPill"));
  modelPill_->setCursor(Qt::PointingHandCursor);
  modelPill_->setToolTip(QStringLiteral("Choose model"));
  connect(modelPill_, &QPushButton::clicked, this, [this] {
    rebuildModelMenu();
    modelPill_->showMenu();
  });
  right->addWidget(modelPill_);

  sendBtn_ = new QPushButton();
  sendBtn_->setProperty("send", true);
  sendBtn_->setFixedSize(36, 36);
  sendBtn_->setCursor(Qt::PointingHandCursor);
  sendBtn_->setToolTip(QStringLiteral("Send message"));
  sendBtn_->setIcon(icon(QStringLiteral("arrow-up"), QColor(QStringLiteral("#ffffff"))));
  sendBtn_->setIconSize(QSize(16, 16));
  connect(sendBtn_, &QPushButton::clicked, this, [this] {
    if (busy_) {
      emit stopRequested();
      return;
    }
    const QString text = input_->toPlainText().trimmed();
    if (text.isEmpty() && pending_.isEmpty()) return;
    emit sendRequested(text, pending_);
  });
  right->addWidget(sendBtn_);
  tools->addLayout(right);
  bl->addLayout(tools);
  root->addWidget(box_);

  auto* disclaimer = new QLabel(QStringLiteral("Claude Code can make mistakes. Check important info."));
  disclaimer->setAlignment(Qt::AlignCenter);
  disclaimer->setStyleSheet(QStringLiteral("font-size:11px; color:#716c65; background:transparent; padding-top:4px;"));
  root->addWidget(disclaimer);

  refreshToggles();
  refreshModelLabel();
}

void Composer::setSettings(const ChatSettings& s) {
  settings_ = s;
  refreshToggles();
  refreshModelLabel();
}

void Composer::setDisplay(const DisplaySettings& d) {
  display_ = d;
  QFont f = input_->font();
  f.setFamily(displayFontFamily(d.font));
  f.setPixelSize(d.fontSize);
  input_->setFont(f);
}

void Composer::setBusy(bool busy) {
  busy_ = busy;
  if (busy) {
    sendBtn_->setIcon(icon(QStringLiteral("square"), QColor(QStringLiteral("#ffffff"))));
    sendBtn_->setToolTip(QStringLiteral("Stop generating"));
  } else {
    sendBtn_->setIcon(icon(QStringLiteral("arrow-up"), QColor(QStringLiteral("#ffffff"))));
    sendBtn_->setToolTip(QStringLiteral("Send message"));
  }
}

void Composer::clearInput() {
  input_->clear();
  pending_.clear();
  refreshChips();
}

void Composer::setSeedText(const QString& text) {
  input_->setPlainText(text);
  input_->setFocus();
}

void Composer::refreshToggles() {
  for (auto it = toggles_.begin(); it != toggles_.end(); ++it) {
    it.value()->blockSignals(true);
    if (it.key() == QStringLiteral("__thinking"))
      it.value()->setChecked(settings_.thinking);
    else
      it.value()->setChecked(settings_.tools.contains(it.key()));
    it.value()->blockSignals(false);
  }
}

void Composer::refreshChips() {
  for (QWidget* w : chipWidgets_) {
    chips_->layout()->removeWidget(w);
    w->deleteLater();
  }
  chipWidgets_.clear();
  for (const FilePart& f : pending_) {
    const bool isImage = f.mime.startsWith(QStringLiteral("image/"));
    auto* chip = new QFrame();
    chip->setObjectName(QStringLiteral("fileChip"));
    auto* hl = new QHBoxLayout(chip);
    hl->setContentsMargins(10, 6, 6, 6);
    hl->setSpacing(6);
    auto* ic = new QLabel();
    ic->setPixmap(icon(isImage ? QStringLiteral("image") : QStringLiteral("file-text"),
                       QColor(QStringLiteral("#d9966a")))
                      .pixmap(12, 12));
    ic->setStyleSheet(QStringLiteral("background:transparent; border:none;"));
    auto* name = new QLabel(f.name);
    name->setStyleSheet(QStringLiteral(
        "font-size:12px; color:#a8a29a; background:transparent; border:none;"));
    auto* x = new QPushButton();
    x->setFixedSize(20, 20);
    x->setCursor(Qt::PointingHandCursor);
    x->setProperty("iconBtn", true);
    x->setIcon(icon(QStringLiteral("x"), QColor(QStringLiteral("#716c65"))));
    x->setIconSize(QSize(13, 13));
    x->setToolTip(QStringLiteral("Remove"));
    hl->addWidget(ic);
    hl->addWidget(name);
    hl->addWidget(x);
    const QString id = f.artifactId;
    connect(x, &QPushButton::clicked, this, [this, id] {
      for (int i = 0; i < pending_.size(); ++i)
        if (pending_[i].artifactId == id) {
          pending_.removeAt(i);
          break;
        }
      refreshChips();
    });
    chips_->layout()->addWidget(chip);
    chipWidgets_.append(chip);
  }
  chips_->setVisible(!pending_.isEmpty());
}

void Composer::refreshModelLabel() {
  if (!modelPill_) return;
  modelPill_->setText(providerGlyph(settings_.provider) + QStringLiteral(" ") +
                      modelLabel(settings_.provider, settings_.model) + QStringLiteral("  ▾"));
}

void Composer::rebuildModelMenu() {
  if (!modelPill_) return;
  if (QMenu* old = modelPill_->menu()) {
    old->deleteLater();
    modelPill_->setMenu(nullptr);
  }
  auto* menu = new QMenu(modelPill_);
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
        settings_ = s;
        refreshToggles();
        refreshModelLabel();
        emit settingsChanged(s);
      });
    }
  }
  modelPill_->setMenu(menu);
}

void Composer::attachFiles(const QStringList& paths) {
  for (const QString& p : paths) {
    QFile f(p);
    if (!f.open(QIODevice::ReadOnly)) continue;
    const QByteArray data = f.readAll();
    f.close();
    const ArtifactMeta a = importArtifactFile(p.split(QLatin1Char('/')).last(), data, {});
    FilePart part;
    part.artifactId = a.id;
    part.name = a.filename;
    part.url = a.url;
    part.type = a.type;
    part.mime = a.mime;
    part.data = data;
    pending_.push_back(part);
  }
  refreshChips();
}

void Composer::dragEnterEvent(QDragEnterEvent* e) {
  if (e->mimeData()->hasUrls()) {
    dragging_ = true;
    box_->setStyleSheet(QStringLiteral(
        "#composerBox { background-color:#262524; border:1px dashed #d9966a;"
        " border-radius:22px; }"));
    e->acceptProposedAction();
  }
}

void Composer::dragLeaveEvent(QDragLeaveEvent* e) {
  dragging_ = false;
  box_->setStyleSheet(QStringLiteral(
      "#composerBox { background-color:#262524; border:1px solid #4d4a46;"
      " border-radius:22px; }"));
  e->accept();
}

void Composer::dropEvent(QDropEvent* e) {
  dragging_ = false;
  box_->setStyleSheet(QStringLiteral(
      "#composerBox { background-color:#262524; border:1px solid #4d4a46;"
      " border-radius:22px; }"));
  QStringList paths;
  for (const QUrl& u : e->mimeData()->urls())
    if (u.isLocalFile()) paths << u.toLocalFile();
  if (!paths.isEmpty()) {
    attachFiles(paths);
    e->acceptProposedAction();
  }
}

bool Composer::eventFilter(QObject* watched, QEvent* e) {
  if (watched == input_) {
    if (e->type() == QEvent::FocusIn) {
      box_->setStyleSheet(QStringLiteral(
          "#composerBox { background-color:#262524; border:1px solid #d9966a;"
          " border-radius:22px; }"));
    } else if (e->type() == QEvent::FocusOut) {
      box_->setStyleSheet(QStringLiteral(
          "#composerBox { background-color:#262524; border:1px solid #4d4a46;"
          " border-radius:22px; }"));
    } else if (e->type() == QEvent::KeyPress) {
      auto* ke = static_cast<QKeyEvent*>(e);
      if (ke->key() == Qt::Key_Return || ke->key() == Qt::Key_Enter) {
        if (!(ke->modifiers() & Qt::ShiftModifier)) {
          const QString text = input_->toPlainText().trimmed();
          if (!busy_ && (!text.isEmpty() || !pending_.isEmpty())) emit sendRequested(text, pending_);
          else if (busy_) emit stopRequested();
          return true;
        }
      } else if (ke->key() == Qt::Key_V && (ke->modifiers() & Qt::ControlModifier)) {
        const QMimeData* md = QGuiApplication::clipboard()->mimeData();
        if (md && md->hasUrls() && !md->urls().isEmpty()) {
          QStringList paths;
          for (const QUrl& u : md->urls())
            if (u.isLocalFile()) paths << u.toLocalFile();
          if (!paths.isEmpty()) {
            attachFiles(paths);
            return true;
          }
        }
      }
    }
  }
  return QFrame::eventFilter(watched, e);
}

}  // namespace omnia
