#include "chatview.h"

#include <QClipboard>
#include <QContextMenuEvent>
#include <QDesktopServices>
#include <QFrame>
#include <QGridLayout>
#include <QGuiApplication>
#include <QHBoxLayout>
#include <QLabel>
#include <QMenu>
#include <QMouseEvent>
#include <QPushButton>
#include <QResizeEvent>
#include <QScrollBar>
#include <QToolButton>
#include <QUrl>

#include <functional>

#include "core/display.h"
#include "ui/icons.h"
#include "ui/markdown.h"

namespace omnia {

static QWidget* makeIconTile(const QString& name, int size = 36, const QString& bg = QStringLiteral("#24d9966a")) {
  auto* tile = new QFrame();
  auto* l = new QHBoxLayout(tile);
  l->setContentsMargins(0, 0, 0, 0);
  l->setAlignment(Qt::AlignCenter);
  auto* ic = new QLabel();
  ic->setPixmap(icon(name, QColor(QStringLiteral("#d9966a"))).pixmap(16, 16));
  l->addWidget(ic);
  tile->setFixedSize(size, size);
  tile->setStyleSheet(QStringLiteral("background-color:%1; border-radius:10px;").arg(bg));
  return tile;
}

class ClickableFrame : public QFrame {
 public:
  explicit ClickableFrame(QWidget* parent = nullptr) : QFrame(parent) {}
  std::function<void()> onClick;

 protected:
  void mouseReleaseEvent(QMouseEvent* e) override {
    if (e->button() == Qt::LeftButton && onClick) onClick();
    QFrame::mouseReleaseEvent(e);
  }
};

ChatView::ChatView(QWidget* parent) : QScrollArea(parent) {
  setWidgetResizable(true);
  setFrameShape(QFrame::NoFrame);
  setHorizontalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
  setStyleSheet(QStringLiteral("background:transparent;"));

  auto* viewportWrap = new QWidget();
  auto* outer = new QVBoxLayout(viewportWrap);
  outer->setContentsMargins(0, 0, 0, 0);
  container_ = new QWidget();
  layout_ = new QVBoxLayout(container_);
  layout_->setContentsMargins(24, 24, 24, 24);
  layout_->setSpacing(16);
  outer->addWidget(container_, 0, Qt::AlignHCenter);
  setWidget(viewportWrap);

  connect(verticalScrollBar(), &QScrollBar::valueChanged, this, [this](int) {
    autoScroll_ = isAtBottom();
  });

  subchatFab_ = new QPushButton(this);
  subchatFab_->setObjectName(QStringLiteral("subchatFab"));
  subchatFab_->setFixedSize(36, 36);
  subchatFab_->setCursor(Qt::PointingHandCursor);
  subchatFab_->setToolTip(QStringLiteral("Open subchat (shares context with this chat)"));
  subchatFab_->setIcon(icon(QStringLiteral("messages-square"), QColor(QStringLiteral("#a8a29a"))));
  subchatFab_->setIconSize(QSize(16, 16));
  connect(subchatFab_, &QPushButton::clicked, this, &ChatView::subchatOpenRequested);
  subchatFab_->raise();
  positionFab();

  empty_ = buildEmptyState();
  layout_->addWidget(empty_);
  layout_->addStretch(1);
}

void ChatView::setSubchatOpen(bool open) {
  subchatOpen_ = open;
  positionFab();
}

void ChatView::setFabEnabled(bool enabled) {
  fabEnabled_ = enabled;
  positionFab();
}

void ChatView::positionFab() {
  if (!subchatFab_) return;
  const bool show = fabEnabled_ && !subchatOpen_;
  subchatFab_->setVisible(show);
  if (show) {
    const int x = width() - 12 - 36 - verticalScrollBar()->width();
    subchatFab_->move(qMax(0, x), 12);
    subchatFab_->raise();
  }
}

void ChatView::resizeEvent(QResizeEvent* e) {
  QScrollArea::resizeEvent(e);
  positionFab();
}

QWidget* ChatView::buildEmptyState() {
  auto* wrap = new QWidget();
  auto* e = new QVBoxLayout(wrap);
  e->setContentsMargins(24, 40, 24, 24);
  e->setSpacing(0);
  e->setAlignment(Qt::AlignHCenter);

  auto* tile = makeIconTile(QStringLiteral("sparkles"), 48, QStringLiteral("#24d9966a"));
  tile->setStyleSheet(QStringLiteral(
      "background:qlineargradient(x1:0,y1:0,x2:1,y2:1,"
      "stop:0 #24d9966a, stop:1 #33d9966a); border-radius:16px;"));
  auto* tileWrap = new QWidget();
  auto* tw = new QHBoxLayout(tileWrap);
  tw->setContentsMargins(0, 0, 0, 20);
  tw->setAlignment(Qt::AlignCenter);
  tw->addWidget(tile);
  e->addWidget(tileWrap);

  auto* h = new QLabel(QStringLiteral("How can I help you today?"));
  h->setAlignment(Qt::AlignCenter);
  h->setStyleSheet(
      QStringLiteral("font-size:26px; font-weight:600; letter-spacing:-0.5px; color:#e8e6e2; background:transparent;"));
  e->addWidget(h);

  auto* sub = new QLabel(QStringLiteral(
      "Chat with multiple providers, search the web, create artifacts, and "
      "deploy autonomous agents in Docker sandboxes."));
  sub->setAlignment(Qt::AlignCenter);
  sub->setWordWrap(true);
  sub->setMaximumWidth(480);
  sub->setStyleSheet(QStringLiteral(
      "font-size:13.5px; line-height:1.5; color:#716c65; background:transparent; margin-top:8px;"));
  e->addWidget(sub, 0, Qt::AlignHCenter);
  e->addSpacing(32);

  struct Suggestion {
    QString icon;
    QString title;
    QString prompt;
  };
  const Suggestion cards[] = {
      {QStringLiteral("file-search"), QStringLiteral("Research a topic"),
       QStringLiteral(
           "Run deep research on a topic of your choice with the runAgentTask sandbox agent — "
           "enable its research mode (research: true, live Chromium browser). Have the agent search "
           "the web, actually open and read at least 3 real pages, cross-check facts across sources, "
           "then save a detailed briefing with a Sources section to /workspace/out/briefing.md. Then "
           "give me a concise summary of the key findings and link the briefing file.")},
      {QStringLiteral("file-spreadsheet"), QStringLiteral("Generate a spreadsheet"),
       QStringLiteral(
           "Create an XLSX spreadsheet in a Docker sandbox with a sample sales dataset (20 rows, "
           "5 columns: region, product, units, price, revenue) plus a summary sheet with totals.")},
      {QStringLiteral("code-xml"), QStringLiteral("Build something"),
       QStringLiteral(
           "Create a code artifact: a small interactive HTML page that visualizes the Fibonacci "
           "sequence with an animated bar chart.")},
      {QStringLiteral("brain-circuit"), QStringLiteral("Plan with an agent"),
       QStringLiteral(
           "Deploy an agent in a Docker sandbox to write a markdown project plan for launching a "
           "SaaS product, and save the plan to /workspace/out as a .md file.")},
  };
  auto* grid = new QGridLayout();
  grid->setSpacing(10);
  for (int i = 0; i < 4; ++i) {
    auto* card = new ClickableFrame();
    card->setObjectName(QStringLiteral("suggestion"));
    card->setCursor(Qt::PointingHandCursor);
    auto* cl = new QVBoxLayout(card);
    cl->setContentsMargins(16, 14, 16, 14);
    cl->setSpacing(8);
    cl->setAlignment(Qt::AlignTop);
    auto* row = new QHBoxLayout();
    row->setSpacing(8);
    auto* ic = new QLabel();
    ic->setPixmap(icon(cards[i].icon, QColor(QStringLiteral("#d9966a"))).pixmap(17, 17));
    ic->setStyleSheet(QStringLiteral("background:transparent; border:none;"));
    auto* title = new QLabel(cards[i].title);
    title->setStyleSheet(
        QStringLiteral("font-size:13px; font-weight:600; color:#a8a29a; background:transparent; border:none;"));
    row->addWidget(ic);
    row->addWidget(title, 1);
    cl->addLayout(row);
    auto* desc = new QLabel(cards[i].prompt);
    desc->setWordWrap(true);
    desc->setMaximumHeight(56);
    desc->setStyleSheet(QStringLiteral(
        "font-size:12.5px; line-height:1.5; color:#716c65; background:transparent; border:none;"));
    cl->addWidget(desc);
    const QString prompt = cards[i].prompt;
    card->onClick = [this, prompt] { emit suggestionClicked(prompt); };
    grid->addWidget(card, i / 2, i % 2);
  }
  auto* gridWrap = new QWidget();
  gridWrap->setMaximumWidth(768);
  gridWrap->setLayout(grid);
  e->addWidget(gridWrap, 0, Qt::AlignHCenter);
  e->addStretch(1);
  return wrap;
}

void ChatView::setDisplay(const DisplaySettings& d) {
  display_ = d;
  container_->setFixedWidth(d.contentWidth + 48);
}

void ChatView::showSuggestions(bool show) { empty_->setVisible(show); }

void ChatView::clear() {
  while (QLayoutItem* item = layout_->takeAt(0)) {
    QWidget* w = item->widget();
    if (w && w != empty_) w->deleteLater();
    delete item;
  }
  streamEdit_ = nullptr;
  streamBubble_ = nullptr;
  streamReasoning_ = nullptr;
  streamReasoningEdit_ = nullptr;
  toolCards_.clear();
  toolInput_.clear();
  toolNames_.clear();
  sources_.clear();
  autoScroll_ = true;
  layout_->addWidget(empty_);
  layout_->addStretch(1);
}

void ChatView::applySources(QString* md) const {
  for (const SourcePart& s : sources_) {
    const QString token = QStringLiteral("[") + QString::number(s.n) + QStringLiteral("]");
    const QString repl = QStringLiteral("[") + QString::number(s.n) + QStringLiteral("](") + s.url +
                         QStringLiteral(")");
    if (md->contains(token)) md->replace(token, repl);
  }
}

QString ChatView::renderMarkdownSource(const QString& raw) const {
  QString md = raw;
  applySources(&md);
  return md;
}

void ChatView::fit(QTextEdit* edit) {
  if (!edit) return;
  edit->document()->adjustSize();
  const int h = int(edit->document()->size().height()) + 10;
  edit->setFixedHeight(qMax(28, h));
}

QTextEdit* ChatView::makeMarkdown(const QString& md, bool*) {
  auto* edit = new QTextEdit();
  edit->setReadOnly(true);
  edit->setFrameShape(QFrame::NoFrame);
  edit->setVerticalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
  edit->setHorizontalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
  edit->setLineWrapMode(QTextEdit::WidgetWidth);
  QFont f = edit->font();
  f.setFamily(displayFontFamily(display_.font));
  f.setPixelSize(display_.fontSize);
  edit->setFont(f);
  edit->setHtml(renderMarkdownHtml(renderMarkdownSource(md), displayFontFamily(display_.font),
                                   display_.fontSize));
  edit->setStyleSheet(QStringLiteral("background:transparent; border:none; color:#e8e6e2;"));
  fit(edit);
  connect(edit->document(), &QTextDocument::contentsChanged, edit, [edit, this] { fit(edit); });
  return edit;
}

QWidget* ChatView::buildThinkingBlock(const QString& reasoning, bool streaming) {
  auto* wrap = new QWidget();
  auto* wl = new QVBoxLayout(wrap);
  wl->setContentsMargins(0, 0, 0, 0);
  wl->setSpacing(4);

  auto* head = new QPushButton();
  head->setFlat(true);
  head->setCheckable(false);
  head->setCursor(reasoning.isEmpty() ? Qt::ArrowCursor : Qt::PointingHandCursor);
  auto* hl = new QHBoxLayout(head);
  hl->setContentsMargins(0, 0, 0, 0);
  hl->setSpacing(6);
  auto* brain = new QLabel();
  brain->setPixmap(
      icon(QStringLiteral("brain"), QColor(streaming ? QStringLiteral("#d9966a") : QStringLiteral("#b07a58")))
          .pixmap(13, 13));
  auto* word = new QLabel(streaming ? QStringLiteral("Thinking ···") : QStringLiteral("Thinking"));
  word->setStyleSheet(
      QStringLiteral("font-size:12.5px; font-weight:500; color:%1; background:transparent; border:none;")
          .arg(streaming ? QStringLiteral("#d9966a") : QStringLiteral("#716c65")));
  brain->setStyleSheet(QStringLiteral("background:transparent; border:none;"));
  hl->addWidget(brain);
  hl->addWidget(word);
  auto* chev = new QLabel();
  chev->setPixmap(icon(QStringLiteral("chevron-down"), QColor(QStringLiteral("#716c65"))).pixmap(12, 12));
  chev->setStyleSheet(QStringLiteral("background:transparent; border:none;"));
  chev->setVisible(!reasoning.isEmpty());
  hl->addWidget(chev);
  hl->addStretch(1);
  head->setStyleSheet(QStringLiteral("background:transparent; border:none; padding:0; text-align:left;"));

  auto* body = makeMarkdown(reasoning);
  body->setVisible(false);
  auto* bodyWrap = new QFrame();
  bodyWrap->setStyleSheet(QStringLiteral(
      "background-color:#cc222120; border:1px solid #383634; border-radius:12px;"));
  auto* bw = new QVBoxLayout(bodyWrap);
  bw->setContentsMargins(12, 10, 12, 10);
  bw->addWidget(body);
  bodyWrap->setVisible(false);

  connect(head, &QPushButton::clicked, this, [body, bodyWrap, chev, reasoning] {
    const bool show = !body->isVisible();
    body->setVisible(show);
    bodyWrap->setVisible(show);
    chev->setPixmap(icon(show ? QStringLiteral("chevron-up") : QStringLiteral("chevron-down"),
                         QColor(QStringLiteral("#716c65")))
                        .pixmap(12, 12));
    Q_UNUSED(reasoning);
  });

  wl->addWidget(head);
  wl->addWidget(bodyWrap);
  return wrap;
}

QWidget* ChatView::buildUserMessage(const ChatMessage& m) {
  QString text;
  QList<FilePart> files;
  for (const MessagePart& p : m.parts) {
    if (p.kind == MessagePart::Text) text += p.text.text;
    if (p.kind == MessagePart::File) files.push_back(p.file);
    if (p.kind == MessagePart::Source) sources_.push_back(p.source);
  }

  auto* wrap = new QWidget();
  auto* lay = new QHBoxLayout(wrap);
  lay->setContentsMargins(4, 12, 4, 12);
  lay->setSpacing(12);
  lay->setAlignment(Qt::AlignLeft | Qt::AlignTop);

  auto* av = new QLabel();
  av->setPixmap(icon(QStringLiteral("user"), QColor(QStringLiteral("#ffffff"))).pixmap(14, 14));
  av->setFixedSize(28, 28);
  av->setAlignment(Qt::AlignCenter);
  av->setStyleSheet(QStringLiteral(
      "background:qlineargradient(x1:0,y1:0,x2:1,y2:1,stop:0 #d9966a, stop:1 #9a5a31);"
      " border-radius:14px;"));
  lay->addWidget(av, 0, Qt::AlignTop);

  auto* col = new QVBoxLayout();
  col->setSpacing(8);
  col->setContentsMargins(0, 2, 0, 0);
  QList<FilePart> images;
  QList<FilePart> others;
  for (const FilePart& f : files) {
    if (f.mime.startsWith(QStringLiteral("image/")))
      images.push_back(f);
    else
      others.push_back(f);
  }
  if (!images.isEmpty()) {
    auto* imgRow = new QHBoxLayout();
    imgRow->setSpacing(8);
    imgRow->setContentsMargins(0, 0, 0, 0);
    for (const FilePart& f : images) {
      QPixmap pm;
      if (!f.data.isEmpty()) pm.loadFromData(f.data);
      auto* img = new QLabel();
      img->setToolTip(f.name);
      if (!pm.isNull()) {
        img->setPixmap(pm.scaled(220, 160, Qt::KeepAspectRatio, Qt::SmoothTransformation));
      } else {
        img->setText(f.name);
        img->setProperty("muted", true);
      }
      img->setStyleSheet(QStringLiteral(
          "background-color:#222120; border:1px solid #383634; border-radius:12px; padding:4px;"));
      imgRow->addWidget(img, 0, Qt::AlignLeft);
    }
    imgRow->addStretch(1);
    col->addLayout(imgRow);
  }
  if (!others.isEmpty()) {
    auto* chipRow = new QHBoxLayout();
    chipRow->setSpacing(6);
    chipRow->setContentsMargins(0, 0, 0, 0);
    for (const FilePart& f : others) {
      auto* chip = new ClickableFrame();
      chip->setObjectName(QStringLiteral("fileChip"));
      chip->setCursor(Qt::PointingHandCursor);
      chip->setToolTip(f.name);
      auto* hl = new QHBoxLayout(chip);
      hl->setContentsMargins(10, 6, 10, 6);
      hl->setSpacing(8);
      auto* ic = new QLabel();
      ic->setPixmap(
          icon(QStringLiteral("file-text"), QColor(QStringLiteral("#d9966a"))).pixmap(13, 13));
      ic->setStyleSheet(QStringLiteral("background:transparent; border:none;"));
      auto* nm = new QLabel(f.name);
      nm->setStyleSheet(QStringLiteral(
          "font-size:12px; color:#a8a29a; background:transparent; border:none;"));
      hl->addWidget(ic);
      hl->addWidget(nm);
      const QString aid = f.artifactId;
      if (!aid.isEmpty()) chip->onClick = [this, aid] { emit openArtifactRequested(aid); };
      chipRow->addWidget(chip, 0, Qt::AlignLeft);
    }
    chipRow->addStretch(1);
    col->addLayout(chipRow);
  }
  if (!text.isEmpty()) {
    auto* te = new QLabel(text);
    te->setWordWrap(true);
    te->setTextInteractionFlags(Qt::TextSelectableByMouse | Qt::LinksAccessibleByMouse);
    te->setStyleSheet(QStringLiteral(
        "font-size:14.5px; line-height:1.55; color:#e8e6e2; background:transparent;"));
    te->setMaximumWidth(720);
    col->addWidget(te, 0, Qt::AlignLeft);
  }
  if (text.isEmpty() && files.isEmpty()) {
    auto* emptyNote = new QLabel(QStringLiteral("(empty)"));
    emptyNote->setStyleSheet(QStringLiteral(
        "font-size:14.5px; font-style:italic; color:#716c65; background:transparent;"));
    col->addWidget(emptyNote, 0, Qt::AlignLeft);
  }
  lay->addLayout(col, 1);
  return wrap;
}

QWidget* ChatView::buildMessage(const ChatMessage& m) {
  if (m.role == "user") return buildUserMessage(m);

  if (m.role == "tool") {
    auto* card = new QFrame();
    card->setStyleSheet(QStringLiteral(
        "background-color:#262524; border:1px solid #383634; border-radius:14px;"));
    auto* l = new QVBoxLayout(card);
    l->setContentsMargins(12, 10, 12, 10);
    auto* t = new QLabel(QStringLiteral("tool results · ") + QString::number(m.parts.size()) +
                         QStringLiteral(" output(s)"));
    t->setProperty("muted", true);
    l->addWidget(t);
    for (const MessagePart& p : m.parts)
      if (p.kind == MessagePart::ToolResult) {
        QString out;
        if (p.toolResult.output.isString())
          out = p.toolResult.output.toString();
        else if (p.toolResult.output.isObject())
          out = QString::fromUtf8(
              QJsonDocument(p.toolResult.output.toObject()).toJson(QJsonDocument::Indented));
        else if (p.toolResult.output.isArray())
          out = QString::fromUtf8(
              QJsonDocument(p.toolResult.output.toArray()).toJson(QJsonDocument::Indented));
        else
          out = p.toolResult.output.toVariant().toString();
        auto* te = makeMarkdown(QStringLiteral("```\n") + out.left(1200) + QStringLiteral("\n```"));
        l->addWidget(te);
      }
    return card;
  }

  auto* body = new QWidget();
  auto* bl = new QVBoxLayout(body);
  bl->setContentsMargins(0, 0, 0, 0);
  bl->setSpacing(8);

  QString text;
  QString reasoning;
  QVector<const MessagePart*> calls;
  QVector<SourcePart> localSources;
  for (const MessagePart& p : m.parts) {
    if (p.kind == MessagePart::Text) text += p.text.text;
    if (p.kind == MessagePart::Reasoning) reasoning += p.reasoning.text;
    if (p.kind == MessagePart::ToolCall) calls.push_back(&p);
    if (p.kind == MessagePart::Source) {
      sources_.push_back(p.source);
      localSources.push_back(p.source);
    }
  }

  if (!localSources.isEmpty()) {
    auto* chips = new QHBoxLayout();
    chips->setSpacing(6);
    chips->setContentsMargins(0, 0, 0, 4);
    for (const SourcePart& s : localSources) {
      QString host = s.url;
      const int slash = host.indexOf(QLatin1String("://"));
      if (slash >= 0) host = host.mid(slash + 3);
      if (host.startsWith(QLatin1String("www."))) host = host.mid(4);
      const int cut = host.indexOf(QLatin1Char('/'));
      if (cut >= 0) host = host.left(cut);
      auto* chip = new QPushButton();
      auto* hl = new QHBoxLayout(chip);
      hl->setContentsMargins(10, 4, 10, 4);
      hl->setSpacing(6);
      auto* ic = new QLabel();
      ic->setPixmap(icon(QStringLiteral("link-2"), QColor(QStringLiteral("#d9966a"))).pixmap(11, 11));
      ic->setStyleSheet(QStringLiteral("background:transparent; border:none;"));
      auto* lb = new QLabel(s.title.isEmpty() ? host : s.title);
      lb->setStyleSheet(QStringLiteral(
          "font-size:11.5px; color:#a8a29a; background:transparent; border:none;"));
      hl->addWidget(ic);
      hl->addWidget(lb);
      chip->setCursor(Qt::PointingHandCursor);
      chip->setToolTip(s.url);
      chip->setStyleSheet(QStringLiteral(
          "QPushButton { background-color:#262524; border:1px solid #383634; border-radius:12px; }"
          "QPushButton:hover { border-color:#66d9966a; }"));
      const QString url = s.url;
      connect(chip, &QPushButton::clicked, chip, [url] { QDesktopServices::openUrl(QUrl(url)); });
      chips->addWidget(chip, 0, Qt::AlignLeft);
    }
    chips->addStretch(1);
    bl->addLayout(chips);
  }

  if (!reasoning.isEmpty()) bl->addWidget(buildThinkingBlock(reasoning, false));

  for (const MessagePart* p : calls) {
    auto* card = new QFrame();
    card->setStyleSheet(QStringLiteral(
        "background-color:#262524; border:1px solid #383634; border-radius:12px;"));
    auto* cl = new QVBoxLayout(card);
    cl->setContentsMargins(12, 10, 12, 10);
    auto* name = new QLabel(p->toolCall.name);
    name->setStyleSheet(
        QStringLiteral("font-weight:600; font-size:13px; color:#d9966a; background:transparent; border:none;"));
    cl->addWidget(name);
    auto* args = new QLabel(QString(QJsonDocument(p->toolCall.input).toJson(QJsonDocument::Compact)));
    args->setProperty("muted", true);
    args->setWordWrap(true);
    cl->addWidget(args);
    if (p->toolCall.name == QStringLiteral("computer_screenshot") ||
        p->toolCall.name == QStringLiteral("computer_navigate") ||
        p->toolCall.name.startsWith(QStringLiteral("computer_"))) {
      auto* open = new QPushButton(QStringLiteral("Open Chromium panel"));
      open->setProperty("accent", true);
      connect(open, &QPushButton::clicked, this, &ChatView::computerCardClicked);
      cl->addWidget(open, 0, Qt::AlignLeft);
    }
    if (p->toolCall.name == QStringLiteral("runAgentTask")) {
      auto* open = new QPushButton(QStringLiteral("Open Agents panel"));
      open->setProperty("accent", true);
      connect(open, &QPushButton::clicked, this, [this] { emit agentCardClicked({}); });
      cl->addWidget(open, 0, Qt::AlignLeft);
    }
    if (p->toolCall.name == QStringLiteral("createArtifact")) {
      auto* open = new QPushButton(QStringLiteral("Open artifact"));
      open->setProperty("accent", true);
      connect(open, &QPushButton::clicked, this, [this] { emit openArtifactRequested({}); });
      cl->addWidget(open, 0, Qt::AlignLeft);
    }
    bl->addWidget(card);
  }

  if (!text.isEmpty()) {
    auto* te = makeMarkdown(text);
    bl->addWidget(te);
  }
  if (reasoning.isEmpty() && calls.isEmpty() && text.isEmpty() && localSources.isEmpty()) {
    auto* dots = new QLabel(QStringLiteral("…"));
    dots->setProperty("muted", true);
    bl->addWidget(dots);
  }
  return body;
}

void ChatView::appendMessage(const ChatMessage& m) {
  empty_->setVisible(false);
  QWidget* w = buildMessage(m);
  layout_->insertWidget(layout_->count() - 1, w);
  if (autoScroll_) scrollToEnd();
}

void ChatView::beginAssistant() {
  empty_->setVisible(false);
  autoScroll_ = true;
  if (streamBubble_) {
    streamBubble_->deleteLater();
    streamBubble_ = nullptr;
    streamEdit_ = nullptr;
    streamReasoning_ = nullptr;
    streamReasoningEdit_ = nullptr;
  }
  streamBubble_ = new QWidget();
  auto* bl = new QVBoxLayout(streamBubble_);
  bl->setContentsMargins(0, 0, 0, 0);
  bl->setSpacing(6);
  streamReasoning_ = new QLabel();
  streamReasoning_->setProperty("muted", true);
  streamReasoning_->setWordWrap(true);
  streamReasoning_->setVisible(false);
  bl->addWidget(streamReasoning_);
  streamEdit_ = new QTextEdit();
  streamEdit_->setReadOnly(true);
  streamEdit_->setFrameShape(QFrame::NoFrame);
  streamEdit_->setVerticalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
  streamEdit_->setHorizontalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
  streamEdit_->setStyleSheet(QStringLiteral("background:transparent; border:none; color:#e8e6e2;"));
  QFont f = streamEdit_->font();
  f.setFamily(displayFontFamily(display_.font));
  f.setPixelSize(display_.fontSize);
  streamEdit_->setFont(f);
  bl->addWidget(streamEdit_);
  layout_->insertWidget(layout_->count() - 1, streamBubble_);
  scrollToEnd();
}

void ChatView::appendAssistantText(const QString& delta) {
  if (!streamEdit_) beginAssistant();
  QTextCursor c = streamEdit_->textCursor();
  c.movePosition(QTextCursor::End);
  c.insertText(delta);
  streamEdit_->setTextCursor(c);
  fit(streamEdit_);
  if (autoScroll_) scrollToEnd();
}

void ChatView::appendAssistantReasoning(const QString& delta) {
  if (!streamReasoning_) beginAssistant();
  streamReasoning_->setVisible(true);
  streamReasoning_->setText(streamReasoning_->text() + delta);
  if (autoScroll_) scrollToEnd();
}

void ChatView::addToolCard(const QString& callId, const QString& name, const QJsonObject& input) {
  if (name == QLatin1String("webSearch")) {
    auto* card = new QFrame();
    card->setObjectName(QStringLiteral("searchCard"));
    card->setStyleSheet(QStringLiteral(
        "QFrame#searchCard { background-color:#262524; border:1px solid #383634; border-radius:12px; }"));
    auto* cl = new QVBoxLayout(card);
    cl->setContentsMargins(14, 12, 14, 12);
    cl->setSpacing(8);
    auto* head = new QHBoxLayout();
    auto* ic = new QLabel();
    ic->setPixmap(icon(QStringLiteral("globe"), QColor(QStringLiteral("#d9966a"))).pixmap(14, 14));
    auto* t = new QLabel(QStringLiteral("Searching the web for “") +
                         input.value(QStringLiteral("query")).toString() + QStringLiteral("”"));
    t->setStyleSheet(
        QStringLiteral("font-size:13px; font-weight:500; color:#a8a29a; background:transparent; border:none;"));
    head->addWidget(ic);
    head->addWidget(t, 1);
    cl->addLayout(head);
    auto* shimmer = new QLabel(QStringLiteral("…"));
    shimmer->setProperty("muted", true);
    cl->addWidget(shimmer);
    toolCards_.insert(callId, card);
    toolInput_.insert(callId, input);
    toolNames_.insert(callId, name);
    layout_->insertWidget(layout_->count() - 1, card);
    if (autoScroll_) scrollToEnd();
    return;
  }
  auto* card = new QFrame();
  card->setStyleSheet(
      QStringLiteral("background-color:#262524; border:1px solid #383634; border-radius:12px;"));
  auto* cl = new QVBoxLayout(card);
  cl->setContentsMargins(12, 10, 12, 10);
  auto* label = new QLabel(name + QStringLiteral(" …"));
  label->setStyleSheet(
      QStringLiteral("color:#d9966a; font-weight:600; font-size:13px; background:transparent; border:none;"));
  auto* detail = new QLabel(QString(QJsonDocument(input).toJson(QJsonDocument::Compact)));
  detail->setProperty("muted", true);
  detail->setWordWrap(true);
  cl->addWidget(label);
  cl->addWidget(detail);
  toolCards_.insert(callId, card);
  toolInput_.insert(callId, input);
  toolNames_.insert(callId, name);
  layout_->insertWidget(layout_->count() - 1, card);
  if (autoScroll_) scrollToEnd();
}

void ChatView::finishToolCard(const QString& callId, const QJsonValue& output) {
  QWidget* card = toolCards_.value(callId, nullptr);
  if (!card) return;
  const QString name = toolNames_.value(callId);
  if (name == QLatin1String("webSearch") && output.isObject()) {
    rebuildSearchCard(card, toolInput_.value(callId), output.toObject());
    if (autoScroll_) scrollToEnd();
    return;
  }
  auto* lay = card->layout();
  if (!lay) return;
  auto* result = new QLabel();
  result->setWordWrap(true);
  result->setProperty("muted", true);
  QString out;
  if (output.isString())
    out = output.toString();
  else if (output.isObject())
    out = QString::fromUtf8(QJsonDocument(output.toObject()).toJson(QJsonDocument::Compact));
  else if (output.isArray())
    out = QString::fromUtf8(QJsonDocument(output.toArray()).toJson(QJsonDocument::Compact));
  else
    out = output.toVariant().toString();
  if (output.isObject()) {
    const QJsonObject o = output.toObject();
    if (o.contains(QStringLiteral("error"))) result->setProperty("danger", true);
    if (o.contains(QStringLiteral("artifactId"))) {
      auto* open = new QPushButton(QStringLiteral("Open artifact"));
      open->setProperty("accent", true);
      const QString id = o.value(QStringLiteral("artifactId")).toString();
      connect(open, &QPushButton::clicked, this, [this, id] { emit openArtifactRequested(id); });
      lay->addWidget(open);
    }
  }
  result->setText(out.left(500));
  lay->addWidget(result);
  if (autoScroll_) scrollToEnd();
}

void ChatView::rebuildSearchCard(QWidget* card, const QJsonObject& args, const QJsonObject& result) {
  QLayout* lay = card->layout();
  if (!lay) return;
  while (QLayoutItem* it = lay->takeAt(0)) {
    if (QWidget* w = it->widget()) w->deleteLater();
    delete it;
  }
  auto* cl = qobject_cast<QVBoxLayout*>(lay);
  if (!cl) return;
  const QJsonArray arr = result.value(QStringLiteral("results")).toArray();
  const QString query = result.value(QStringLiteral("query")).toString(
      args.value(QStringLiteral("query")).toString());
  auto* head = new QHBoxLayout();
  auto* ic = new QLabel();
  ic->setPixmap(icon(QStringLiteral("globe"), QColor(QStringLiteral("#d9966a"))).pixmap(14, 14));
  auto* title = new QLabel(QStringLiteral("Searched the web for “") + query + QStringLiteral("”"));
  title->setStyleSheet(
      QStringLiteral("font-size:13px; font-weight:500; color:#a8a29a; background:transparent; border:none;"));
  auto* count = new QLabel(QString::number(arr.size()) + QStringLiteral(" results"));
  count->setProperty("muted", true);
  head->addWidget(ic);
  head->addWidget(title, 1);
  head->addWidget(count);
  cl->addLayout(head);

  int base = 0;
  for (const SourcePart& s : sources_)
    if (s.n > base) base = s.n;
  if (arr.isEmpty()) {
    auto* none = new QLabel(QStringLiteral("No results for “") + query + QStringLiteral("”"));
    none->setProperty("muted", true);
    cl->addWidget(none);
    return;
  }
  int i = 0;
  for (const QJsonValue& v : arr) {
    if (i >= 8) break;
    const QJsonObject o = v.toObject();
    int n = o.value(QStringLiteral("n")).toInt(base + i + 1);
    SourcePart sp;
    sp.n = n;
    sp.url = o.value(QStringLiteral("url")).toString();
    sp.title = o.value(QStringLiteral("title")).toString();
    sources_.push_back(sp);

    auto* row = new QFrame();
    row->setCursor(Qt::PointingHandCursor);
    row->setStyleSheet(QStringLiteral(
        "QFrame { background:transparent; border:none; border-radius:8px; }"
        "QFrame:hover { background-color:#0dffffff; }"));
    auto* rl = new QVBoxLayout(row);
    rl->setContentsMargins(8, 6, 8, 6);
    rl->setSpacing(2);
    auto* top = new QHBoxLayout();
    auto* badge = new QLabel(QString::number(n));
    badge->setFixedHeight(16);
    badge->setAlignment(Qt::AlignCenter);
    badge->setStyleSheet(QStringLiteral(
        "background-color:#121211; border-radius:4px; padding:0 4px; font-size:10px; font-weight:700; color:#716c65;"));
    auto* host = new QLabel(o.value(QStringLiteral("hostname")).toString());
    host->setProperty("muted", true);
    auto* openIc = new QLabel();
    openIc->setPixmap(icon(QStringLiteral("external-link"), QColor(QStringLiteral("#716c65"))).pixmap(11, 11));
    top->addWidget(badge);
    top->addWidget(host, 1);
    top->addWidget(openIc);
    rl->addLayout(top);
    auto* rt = new QLabel(o.value(QStringLiteral("title")).toString());
    rt->setWordWrap(true);
    rt->setStyleSheet(QStringLiteral(
        "font-size:13px; font-weight:500; color:#e8e6e2; background:transparent;"));
    rl->addWidget(rt);
    const QString desc = o.value(QStringLiteral("description")).toString();
    if (!desc.isEmpty()) {
      auto* rd = new QLabel(desc);
      rd->setWordWrap(true);
      rd->setProperty("muted", true);
      rl->addWidget(rd);
    }
    const QString url = o.value(QStringLiteral("url")).toString();
    // simple left-click open
    auto* openBtn = new QPushButton(QStringLiteral("Open"));
    openBtn->setProperty("ghost", true);
    connect(openBtn, &QPushButton::clicked, openBtn, [url] { QDesktopServices::openUrl(QUrl(url)); });
    top->addWidget(openBtn);
    cl->addWidget(row);
    ++i;
  }
}

void ChatView::finalizeAssistant(const ChatMessage& m) {
  if (streamBubble_) {
    streamBubble_->deleteLater();
    streamBubble_ = nullptr;
    streamEdit_ = nullptr;
    streamReasoning_ = nullptr;
    streamReasoningEdit_ = nullptr;
  }
  appendMessage(m);
}

void ChatView::scrollToEnd() {
  QScrollBar* sb = verticalScrollBar();
  sb->setValue(sb->maximum());
}

bool ChatView::isAtBottom() const {
  QScrollBar* sb = verticalScrollBar();
  return sb->value() >= sb->maximum() - 4;
}

void ChatView::contextMenuEvent(QContextMenuEvent* e) {
  QMenu m;
  QString selected;
  if (auto* edit = qobject_cast<QTextEdit*>(focusWidget()))
    selected = edit->textCursor().selectedText();
  else if (!QGuiApplication::clipboard()->text().isEmpty())
    selected = QGuiApplication::clipboard()->text();
  QAction* copy = m.addAction(QStringLiteral("Copy"));
  QAction* seed = nullptr;
  if (!selected.isEmpty()) {
    seed = m.addAction(QStringLiteral("Open in subchat"));
    m.addSeparator();
  }
  QAction* chosen = m.exec(e->globalPos());
  if (chosen == copy) {
    if (auto* edit = qobject_cast<QTextEdit*>(focusWidget())) edit->copy();
    else if (!selected.isEmpty()) QGuiApplication::clipboard()->setText(selected);
  } else if (seed && chosen == seed) {
    emit subchatSeedRequested(selected);
  }
}

}  // namespace omnia
