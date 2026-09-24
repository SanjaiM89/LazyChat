#include "artifactpanel.h"

#include <QDateTime>
#include <QDesktopServices>
#include <QHBoxLayout>
#include <QHeaderView>
#include <QLabel>
#include <QPainter>
#include <QPixmap>
#include <QPushButton>
#include <QSvgRenderer>
#include <QTableWidget>
#include <QTextDocument>
#include <QTextEdit>
#include <QUrl>
#include <QVBoxLayout>
#include <QWebEngineSettings>
#include <QWebEngineView>

#include "core/artifacts.h"
#include "core/datastore.h"
#include "core/display.h"
#include "ui/icons.h"

namespace omnia {

static QString artifactTimeAgo(qint64 ts) {
  const qint64 s = qMax<qint64>(0, (QDateTime::currentMSecsSinceEpoch() - ts) / 1000);
  if (s < 60) return QStringLiteral("just now");
  const qint64 m = s / 60;
  if (m < 60) return QString::number(m) + QStringLiteral("m ago");
  const qint64 h = m / 60;
  if (h < 24) return QString::number(h) + QStringLiteral("h ago");
  return QDateTime::fromMSecsSinceEpoch(ts).toString(QStringLiteral("MMM d"));
}

static QString artifactTypeLabel(const QString& t) {
  static const QHash<QString, QString> m = {
      {QStringLiteral("code"), QStringLiteral("Code")},
      {QStringLiteral("markdown"), QStringLiteral("Markdown")},
      {QStringLiteral("html"), QStringLiteral("HTML")},
      {QStringLiteral("svg"), QStringLiteral("SVG")},
      {QStringLiteral("text"), QStringLiteral("Text")},
      {QStringLiteral("pdf"), QStringLiteral("PDF")},
      {QStringLiteral("docx"), QStringLiteral("DOCX")},
      {QStringLiteral("xlsx"), QStringLiteral("Spreadsheet")},
      {QStringLiteral("csv"), QStringLiteral("CSV")},
      {QStringLiteral("image"), QStringLiteral("Image")},
      {QStringLiteral("mermaid"), QStringLiteral("Mermaid")},
      {QStringLiteral("table"), QStringLiteral("Table")},
      {QStringLiteral("audio"), QStringLiteral("Audio")},
  };
  return m.value(t, t);
}

static QWidget* panelHeaderTile(const QString& name) {
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

ArtifactPanel::ArtifactPanel(QWidget* parent) : QFrame(parent) {
  setObjectName(QStringLiteral("panel"));
  auto* root = new QVBoxLayout(this);
  root->setContentsMargins(0, 0, 0, 0);
  root->setSpacing(0);

  auto* head = new QFrame();
  head->setFixedHeight(56);
  head->setStyleSheet(QStringLiteral("border-bottom:1px solid #383634; background-color:#1a1918;"));
  auto* hr = new QHBoxLayout(head);
  hr->setContentsMargins(12, 0, 12, 0);
  hr->setSpacing(8);
  backBtn_ = new QPushButton();
  backBtn_->setFixedSize(32, 32);
  backBtn_->setCursor(Qt::PointingHandCursor);
  backBtn_->setProperty("iconBtn", true);
  backBtn_->setIcon(icon(QStringLiteral("arrow-left")));
  backBtn_->setIconSize(QSize(16, 16));
  backBtn_->setToolTip(QStringLiteral("Back to artifacts"));
  backBtn_->hide();
  connect(backBtn_, &QPushButton::clicked, this, &ArtifactPanel::closeArtifact);
  hr->addWidget(backBtn_);
  tile_ = panelHeaderTile(QStringLiteral("file-text"));
  hr->addWidget(tile_);
  titleLabel_ = new QLabel(QStringLiteral("Artifacts"));
  titleLabel_->setStyleSheet(
      QStringLiteral("font-size:14px; font-weight:600; color:#e8e6e2; background:transparent;"));
  hr->addWidget(titleLabel_, 1);
  auto* closeBtn = new QPushButton();
  closeBtn->setFixedSize(32, 32);
  closeBtn->setCursor(Qt::PointingHandCursor);
  closeBtn->setProperty("iconBtn", true);
  closeBtn->setIcon(icon(QStringLiteral("x")));
  closeBtn->setIconSize(QSize(16, 16));
  connect(closeBtn, &QPushButton::clicked, this, &ArtifactPanel::closeRequested);
  hr->addWidget(closeBtn);
  root->addWidget(head);

  stack_ = new QStackedWidget();
  auto* listPage = new QWidget();
  auto* lp = new QVBoxLayout(listPage);
  lp->setContentsMargins(10, 10, 10, 10);
  lp->setSpacing(0);
  list_ = new QListWidget();
  list_->setSpacing(4);
  connect(list_, &QListWidget::itemClicked, this, [this](QListWidgetItem* cur) {
    if (!cur) return;
    openArtifact(cur->data(Qt::UserRole).toString());
  });
  lp->addWidget(list_, 1);
  emptyLabel_ = new QLabel(
      QStringLiteral("No artifacts yet. Ask the model to create a document, a "
                     "spreadsheet or a diagram — it will show up here."));
  emptyLabel_->setAlignment(Qt::AlignCenter);
  emptyLabel_->setWordWrap(true);
  emptyLabel_->setStyleSheet(QStringLiteral(
      "font-size:13px; color:#716c65; background:transparent; padding:24px 12px;"));
  lp->addWidget(emptyLabel_);
  stack_->addWidget(listPage);

  viewerHost_ = new QWidget();
  auto* vh = new QVBoxLayout(viewerHost_);
  vh->setContentsMargins(0, 0, 0, 0);
  stack_->addWidget(viewerHost_);
  root->addWidget(stack_, 1);
  reload();
}

void ArtifactPanel::reload() {
  const QString keep = currentId_;
  list_->blockSignals(true);
  list_->clear();
  const QVector<ArtifactMeta> arts = listArtifacts();
  emptyLabel_->setVisible(arts.isEmpty());
  for (const ArtifactMeta& a : arts) {
    const QString title = a.title.isEmpty() ? a.filename : a.title;
    auto* row = new QWidget();
    auto* rl = new QHBoxLayout(row);
    rl->setContentsMargins(10, 8, 10, 8);
    rl->setSpacing(10);
    auto* tile = new QFrame();
    auto* tl = new QHBoxLayout(tile);
    tl->setContentsMargins(0, 0, 0, 0);
    tl->setAlignment(Qt::AlignCenter);
    auto* ic = new QLabel();
    ic->setPixmap(icon(QStringLiteral("file-text"), QColor(QStringLiteral("#a8a29a"))).pixmap(14, 14));
    ic->setStyleSheet(QStringLiteral("background:transparent; border:none;"));
    tl->addWidget(ic);
    tile->setFixedSize(32, 32);
    tile->setStyleSheet(QStringLiteral("background-color:#121211; border-radius:8px;"));
    rl->addWidget(tile);
    auto* col = new QVBoxLayout();
    col->setSpacing(1);
    col->setContentsMargins(0, 0, 0, 0);
    auto* t = new QLabel(title);
    t->setStyleSheet(QStringLiteral(
        "font-size:13px; font-weight:500; color:#e8e6e2; background:transparent;"));
    auto* sub = new QLabel(artifactTypeLabel(a.type) + QStringLiteral(" · ") +
                           artifactTimeAgo(a.createdAt > 0 ? a.createdAt : a.updatedAt));
    sub->setStyleSheet(QStringLiteral("font-size:11px; color:#716c65; background:transparent;"));
    col->addWidget(t);
    col->addWidget(sub);
    rl->addLayout(col, 1);
    auto* item = new QListWidgetItem();
    item->setData(Qt::UserRole, a.id);
    item->setToolTip(a.type + (a.filename.isEmpty() ? QString() : QStringLiteral(" · ") + a.filename));
    item->setSizeHint(QSize(0, 52));
    list_->addItem(item);
    list_->setItemWidget(item, row);
    if (a.id == keep) list_->setCurrentItem(item);
  }
  list_->blockSignals(false);
}

void ArtifactPanel::openArtifact(const QString& id) {
  const ArtifactMeta a = getArtifact(id);
  if (a.id.isEmpty()) return;
  currentId_ = id;
  for (int i = 0; i < list_->count(); ++i)
    if (list_->item(i)->data(Qt::UserRole).toString() == id) list_->setCurrentRow(i);
  showArtifact(a);
}

void ArtifactPanel::closeArtifact() {
  currentId_.clear();
  titleLabel_->setText(QStringLiteral("Artifacts"));
  backBtn_->hide();
  tile_->show();
  stack_->setCurrentIndex(0);
}

void ArtifactPanel::showArtifact(const ArtifactMeta& a) {
  QLayout* vh = viewerHost_->layout();
  while (QLayoutItem* it = vh->takeAt(0)) {
    if (QWidget* w = it->widget()) w->deleteLater();
    delete it;
  }
  vh->addWidget(buildViewer(a));
  titleLabel_->setText(a.title.isEmpty() ? a.filename : a.title);
  backBtn_->show();
  tile_->hide();
  stack_->setCurrentIndex(1);
}

static QString escapeHtml(const QString& s) {
  QString o = s;
  o.replace("&", "&amp;");
  o.replace("<", "&lt;");
  o.replace(">", "&gt;");
  return o;
}

QWidget* ArtifactPanel::buildViewer(const ArtifactMeta& a) {
  const QString type = a.type;
  if (type == "html" || type == "pdf") {
    auto* web = new QWebEngineView();
    if (type == "pdf") {
      const QString path = artifactFilePath(a);
      web->load(QUrl::fromLocalFile(path));
    } else {
      QByteArray data = readArtifactBuffer(a);
      if (data.isEmpty()) data = a.content.toUtf8();
      web->setHtml(QString::fromUtf8(data),
                   QUrl::fromLocalFile(DataStore::dataDir() + "/artifacts/" + a.id + "/"));
    }
    web->settings()->setAttribute(QWebEngineSettings::ShowScrollBars, true);
    return web;
  }
  if (type == "image" || type == "audio") {
    auto* wrap = new QWidget();
    auto* l = new QVBoxLayout(wrap);
    auto* label = new QLabel();
    label->setAlignment(Qt::AlignCenter);
    const QByteArray data = readArtifactBuffer(a);
    QPixmap pm;
    if (pm.loadFromData(data))
      label->setPixmap(pm.scaledToWidth(qMin(720, qMax(label->width(), 400)), Qt::SmoothTransformation));
    else
      label->setText("Cannot preview " + type);
    l->addWidget(label, 1);
    auto* open = new QPushButton("Open externally");
    connect(open, &QPushButton::clicked, wrap, [a] {
      QDesktopServices::openUrl(QUrl::fromLocalFile(artifactFilePath(a)));
    });
    l->addWidget(open, 0, Qt::AlignRight);
    return wrap;
  }
  if (type == "csv" || type == "table") {
    QByteArray data = readArtifactBuffer(a);
    if (data.isEmpty()) data = a.content.toUtf8();
    const QString text = QString::fromUtf8(data);
    auto* table = new QTableWidget();
    const QStringList rows = text.split('\n', Qt::SkipEmptyParts);
    if (!rows.isEmpty()) {
      const QStringList headers = rows.first().split(',');
      table->setColumnCount(headers.size());
      table->setHorizontalHeaderLabels(headers);
    }
    for (int r = 1; r < rows.size() && r < 500; ++r) {
      const QStringList cells = rows[r].split(',');
      table->insertRow(r - 1);
      for (int c = 0; c < cells.size(); ++c)
        table->setItem(r - 1, c, new QTableWidgetItem(cells[c]));
    }
    table->horizontalHeader()->setStretchLastSection(true);
    return table;
  }
  if (type == "svg") {
    auto* wrap = new QWidget();
    auto* l = new QVBoxLayout(wrap);
    auto* svgLabel = new QLabel();
    QByteArray data = readArtifactBuffer(a);
    if (data.isEmpty()) data = a.content.toUtf8();
    QSvgRenderer renderer(data);
    if (renderer.isValid()) {
      QPixmap pm(renderer.defaultSize().expandedTo(QSize(200, 200)));
      pm.fill(Qt::transparent);
      QPainter p(&pm);
      renderer.render(&p);
      svgLabel->setPixmap(pm);
    } else {
      svgLabel->setText(QString::fromUtf8(data));
    }
    svgLabel->setAlignment(Qt::AlignCenter);
    l->addWidget(svgLabel, 1);
    return wrap;
  }
  if (type == "code" || type == "mermaid") {
    QByteArray data = readArtifactBuffer(a);
    if (data.isEmpty()) data = a.content.toUtf8();
    auto* wrap = new QWidget();
    auto* l = new QVBoxLayout(wrap);
    l->setContentsMargins(0, 0, 0, 0);
    l->setSpacing(6);
    auto* bar = new QHBoxLayout();
    auto* lang = new QLabel(a.language.isEmpty() ? type : a.language);
    lang->setProperty("badge", true);
    bar->addWidget(lang);
    bar->addStretch(1);
    auto* open = new QPushButton(QStringLiteral("Open externally"));
    open->setProperty("ghost", true);
    connect(open, &QPushButton::clicked, wrap, [a] {
      QDesktopServices::openUrl(QUrl::fromLocalFile(artifactFilePath(a)));
    });
    bar->addWidget(open);
    l->addLayout(bar);
    auto* edit = new QTextEdit();
    edit->setReadOnly(true);
    edit->setFontFamily(QStringLiteral("monospace"));
    edit->setStyleSheet(QStringLiteral(
        "background-color:#121211; border:1px solid #383634; border-radius:10px; color:#e8e6e2;"));
    edit->setPlainText(QString::fromUtf8(data));
    l->addWidget(edit, 1);
    return wrap;
  }
  QByteArray data = readArtifactBuffer(a);
  if (data.isEmpty()) data = a.content.toUtf8();
  auto* edit = new QTextEdit();
  edit->setReadOnly(true);
  const DisplaySettings d = loadDisplay();
  QFont f = edit->font();
  f.setFamily(displayFontFamily(d.font));
  f.setPixelSize(d.fontSize);
  edit->setFont(f);
  const QString text = QString::fromUtf8(data);
  if (type == "markdown")
    edit->setMarkdown(text);
  else
    edit->setPlainText(text);
  return edit;
}

}  // namespace omnia
