#include <QApplication>
#include <QDir>
#include <QLabel>
#include <QPushButton>
#include <QTest>
#include <QTimer>

#include "ui/icons.h"
#include "ui/mainwindow.h"

namespace {

void saveShot(QWidget* w, const QString& path) {
  if (!w || !w->isVisible()) return;
  w->grab().save(path);
}

QPushButton* findButtonByTip(QWidget* root, const QString& tip) {
  for (auto* b : root->findChildren<QPushButton*>()) {
    if (b->toolTip() == tip && b->isVisibleTo(root)) return b;
  }
  return nullptr;
}

QPushButton* findToggleByLabel(QWidget* root, const QString& label) {
  for (auto* b : root->findChildren<QPushButton*>()) {
    if (!b->isVisibleTo(root)) continue;
    if (b->text() == label) return b;
    for (auto* l : b->findChildren<QLabel*>()) {
      if (l->text() == label) return b;
    }
  }
  return nullptr;
}

void runIconDprExperiment() {
  QWidget win;
  win.setWindowTitle(QStringLiteral("icondpr"));
  auto* lay = new QVBoxLayout(&win);
  const QColor muted(QStringLiteral("#716c65"));
  // Row 1: status quo — QIcon::pixmap straight into QLabel.
  auto* l1 = new QLabel(QStringLiteral("stock:"));
  auto* i1 = new QLabel();
  i1->setPixmap(omnia::icon(QStringLiteral("message-square"), muted).pixmap(14, 14));
  auto* r1 = new QHBoxLayout();
  r1->addWidget(l1);
  r1->addWidget(i1);
  r1->addStretch(1);
  lay->addLayout(r1);
  // Row 2: same pixmap bytes but forced dpr=1.
  auto* l2 = new QLabel(QStringLiteral("dpr1:"));
  auto* i2 = new QLabel();
  QPixmap m = omnia::icon(QStringLiteral("message-square"), muted).pixmap(14, 14);
  m.setDevicePixelRatio(1.0);
  i2->setPixmap(m);
  auto* r2 = new QHBoxLayout();
  r2->addWidget(l2);
  r2->addWidget(i2);
  r2->addStretch(1);
  lay->addLayout(r2);
  // Row 3: QPushButton with stock QIcon.
  auto* b3 = new QPushButton(QStringLiteral("btn"));
  b3->setIcon(omnia::icon(QStringLiteral("message-square"), muted));
  b3->setIconSize(QSize(16, 16));
  lay->addWidget(b3);
  win.show();
  QTest::qWait(400);
  win.grab().save(QStringLiteral("/tmp/omnia-shots/icondpr.png"));
  win.close();
}

void runMarkdownShot() {
  auto* v = new omnia::ChatView();
  v->setAttribute(Qt::WA_DeleteOnClose);
  v->resize(900, 700);
  omnia::DisplaySettings d;
  d.contentWidth = 780;
  d.fontSize = 15;
  v->setDisplay(d);
  omnia::ChatMessage m;
  m.role = QStringLiteral("assistant");
  m.id = QStringLiteral("shot");
  auto addText = [&](const QString& t) {
    omnia::MessagePart p;
    p.kind = omnia::MessagePart::Text;
    p.text.text = t;
    m.parts.push_back(p);
  };
  addText(QStringLiteral(
      "# Markdown check\n\nSome **bold** and *italic* with `inline code`, a "
      "[link](https://example.com) and citation [1].\n\n## Table\n\n| Name | Value |\n"
      "|:-----|------:|\n| foo | 42 |\n| bar | 7 |\n\n> A wise quote here.\n\n- item one\n"
      "- item two\n  - nested\n- [ ] todo\n- [x] done\n\n```python\ndef hello(name):\n    "
      "# greet\n    return f\"hi {name}\"  # done\n```\n\n1. first\n2. second\n"));
  omnia::MessagePart s;
  s.kind = omnia::MessagePart::Source;
  s.source.n = 1;
  s.source.url = QStringLiteral("https://example.com");
  s.source.title = QStringLiteral("Example");
  m.parts.push_back(s);
  v->appendMessage(m);
  v->show();
  QTest::qWait(600);
  const QList<QTextEdit*> edits = v->findChildren<QTextEdit*>();
  QFile dbg(QStringLiteral("/tmp/omnia-shots/debug.txt"));
  if (dbg.open(QIODevice::WriteOnly | QIODevice::Truncate)) {
    QString s = QStringLiteral("view=%1x%2\n").arg(v->width()).arg(v->height());
    if (!edits.isEmpty()) {
      const QTextEdit* e = edits.constFirst();
      s += QStringLiteral("edit=%1x%2 viewport=%3x%4 docWidth=%5\n")
               .arg(e->width())
               .arg(e->height())
               .arg(e->viewport()->width())
               .arg(e->viewport()->height())
               .arg(e->document()->size().width());
    } else {
      s += QStringLiteral("no edits\n");
    }
    dbg.write(s.toUtf8());
  }
  saveShot(v, QStringLiteral("/tmp/omnia-shots/06-markdown.png"));
  v->close();
}

void runShots(omnia::MainWindow& w) {
  QDir().mkpath(QStringLiteral("/tmp/omnia-shots"));
  {
    // Pixel-level dump of what QIcon::pixmap hands to labels/buttons.
    const QPixmap p14 = omnia::icon(QStringLiteral("message-square"),
                                    QColor(QStringLiteral("#716c65")))
                            .pixmap(14, 14);
    QFile info(QStringLiteral("/tmp/omnia-shots/iconinfo.txt"));
    if (info.open(QIODevice::WriteOnly | QIODevice::Truncate)) {
      info.write(QStringLiteral("pixmap=%1x%2 dpr=%3 appDpr=%4\n")
                     .arg(p14.width())
                     .arg(p14.height())
                     .arg(p14.devicePixelRatio())
                     .arg(qApp->devicePixelRatio())
                     .toUtf8());
    }
    QPixmap big = p14.scaled(140, 140, Qt::KeepAspectRatio, Qt::FastTransformation);
    big.save(QStringLiteral("/tmp/omnia-shots/iconpx.png"));
  }

  QTest::qWait(1000);
  saveShot(&w, QStringLiteral("/tmp/omnia-shots/01-window.png"));
  auto hoverShot = [&](QWidget* target, const QString& name) {
    if (!target) return;
    QTest::mouseMove(target);
    QTest::qWait(300);
    QApplication::processEvents();
    saveShot(target, QStringLiteral("/tmp/omnia-shots/%1.png").arg(name));
  };
  hoverShot(findButtonByTip(&w, QStringLiteral("Send message")), QStringLiteral("02-send-hover"));
  hoverShot(findToggleByLabel(&w, QStringLiteral("Search")), QStringLiteral("03-toggle-hover"));
  if (auto* comp = w.findChild<omnia::Composer*>())
    saveShot(comp, QStringLiteral("/tmp/omnia-shots/07-composer-hover.png"));
  hoverShot(findButtonByTip(&w, QStringLiteral("Artifacts panel")),
            QStringLiteral("04-header-hover"));
  hoverShot(findButtonByTip(&w, QStringLiteral("Attach a file")),
            QStringLiteral("05-attach-hover"));
  runIconDprExperiment();
  runMarkdownShot();
  QTest::mouseMove(&w, QPoint(10, 10));
  QTest::qWait(200);
}

}  // namespace

int main(int argc, char** argv) {
  QApplication::setOrganizationName("omnia");
  QApplication::setApplicationName("OmniaDesktop");
  QApplication app(argc, argv);
  omnia::MainWindow w;
  w.show();
  if (qEnvironmentVariableIsSet("OMNIA_SHOT")) {
    QTimer::singleShot(500, [&] {
      runShots(w);
      qApp->quit();
    });
  }
  return app.exec();
}
