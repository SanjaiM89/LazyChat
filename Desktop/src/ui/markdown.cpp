#include "ui/markdown.h"

#include <QHash>
#include <QRegularExpression>
#include <QSet>
#include <QStringList>

namespace omnia {

namespace {

QString esc(const QString& s) {
  QString o = s;
  o.replace(QLatin1Char('&'), QStringLiteral("&amp;"));
  o.replace(QLatin1Char('<'), QStringLiteral("&lt;"));
  o.replace(QLatin1Char('>'), QStringLiteral("&gt;"));
  o.replace(QLatin1Char('"'), QStringLiteral("&quot;"));
  return o;
}

const QSet<QString>& codeKeywords() {
  static const QSet<QString> k = {
      QStringLiteral("const"),     QStringLiteral("let"),      QStringLiteral("var"),
      QStringLiteral("function"),  QStringLiteral("return"),   QStringLiteral("if"),
      QStringLiteral("else"),      QStringLiteral("elif"),     QStringLiteral("for"),
      QStringLiteral("while"),     QStringLiteral("do"),       QStringLiteral("switch"),
      QStringLiteral("case"),      QStringLiteral("break"),    QStringLiteral("continue"),
      QStringLiteral("class"),     QStringLiteral("struct"),   QStringLiteral("enum"),
      QStringLiteral("import"),    QStringLiteral("from"),     QStringLiteral("export"),
      QStringLiteral("default"),   QStringLiteral("new"),      QStringLiteral("delete"),
      QStringLiteral("try"),       QStringLiteral("catch"),    QStringLiteral("finally"),
      QStringLiteral("throw"),     QStringLiteral("throws"),   QStringLiteral("def"),
      QStringLiteral("lambda"),    QStringLiteral("pass"),     QStringLiteral("in"),
      QStringLiteral("of"),        QStringLiteral("and"),      QStringLiteral("or"),
      QStringLiteral("not"),       QStringLiteral("with"),     QStringLiteral("as"),
      QStringLiteral("async"),     QStringLiteral("await"),    QStringLiteral("yield"),
      QStringLiteral("True"),      QStringLiteral("False"),    QStringLiteral("None"),
      QStringLiteral("true"),      QStringLiteral("false"),    QStringLiteral("null"),
      QStringLiteral("nil"),       QStringLiteral("this"),     QStringLiteral("self"),
      QStringLiteral("super"),     QStringLiteral("static"),   QStringLiteral("final"),
      QStringLiteral("public"),    QStringLiteral("private"),  QStringLiteral("protected"),
      QStringLiteral("void"),      QStringLiteral("int"),      QStringLiteral("float"),
      QStringLiteral("double"),    QStringLiteral("char"),     QStringLiteral("bool"),
      QStringLiteral("string"),    QStringLiteral("auto"),     QStringLiteral("sizeof"),
      QStringLiteral("typedef"),   QStringLiteral("namespace"), QStringLiteral("using"),
      QStringLiteral("template"),  QStringLiteral("typename"), QStringLiteral("match"),
      QStringLiteral("fn"),        QStringLiteral("mut"),      QStringLiteral("impl"),
      QStringLiteral("trait"),     QStringLiteral("pub"),      QStringLiteral("mod"),
      QStringLiteral("crate"),     QStringLiteral("where"),    QStringLiteral("loop"),
      QStringLiteral("go"),        QStringLiteral("chan"),     QStringLiteral("func"),
      QStringLiteral("package"),   QStringLiteral("select"),   QStringLiteral("defer"),
      QStringLiteral("interface"), QStringLiteral("extends"),  QStringLiteral("implements"),
      QStringLiteral("select"),    QStringLiteral("insert"),   QStringLiteral("update"),
  };
  return k;
}

bool isWordChar(QChar c) { return c.isLetterOrNumber() || c == QLatin1Char('_'); }

// Minimal tokenizer: strings, line/block comments, numbers, keywords.
QString highlightCode(const QString& code) {
  QString out;
  out.reserve(code.size() * 2);
  const int n = code.size();
  int i = 0;
  bool inBlock = false;
  auto flushWord = [&](const QString& w) {
    if (codeKeywords().contains(w))
      out += QStringLiteral("<span style=\"color:#ff7b72\">") + esc(w) +
             QStringLiteral("</span>");
    else
      out += esc(w);
  };
  while (i < n) {
    const QChar c = code[i];
    if (inBlock) {
      if (c == QLatin1Char('*') && i + 1 < n && code[i + 1] == QLatin1Char('/')) {
        out += esc(QStringLiteral("*/")) + QStringLiteral("</span>");
        i += 2;
        inBlock = false;
      } else {
        out += esc(c);
        ++i;
      }
      continue;
    }
    if (c == QLatin1Char('"') || c == QLatin1Char('\'') || c == QLatin1Char('`')) {
      const QChar q = c;
      QString tok;
      tok += c;
      ++i;
      while (i < n) {
        const QChar d = code[i];
        tok += d;
        ++i;
        if (d == QLatin1Char('\\') && i < n) {
          tok += code[i];
          ++i;
          continue;
        }
        if (d == q) break;
        if (q != QLatin1Char('`') && d == QLatin1Char('\n')) break;
      }
      out += QStringLiteral("<span style=\"color:#a5d6ff\">") + esc(tok) +
             QStringLiteral("</span>");
      continue;
    }
    if (c == QLatin1Char('/') && i + 1 < n && code[i + 1] == QLatin1Char('/')) {
      int j = code.indexOf(QLatin1Char('\n'), i);
      if (j < 0) j = n;
      out += QStringLiteral("<span style=\"color:#8b949e\">") + esc(code.mid(i, j - i)) +
             QStringLiteral("</span>");
      i = j;
      continue;
    }
    if (c == QLatin1Char('/') && i + 1 < n && code[i + 1] == QLatin1Char('*')) {
      out += QStringLiteral("<span style=\"color:#8b949e\">") + esc(QStringLiteral("/*"));
      i += 2;
      inBlock = true;
      continue;
    }
    if (c == QLatin1Char('#')) {
      int j = code.indexOf(QLatin1Char('\n'), i);
      if (j < 0) j = n;
      out += QStringLiteral("<span style=\"color:#8b949e\">") + esc(code.mid(i, j - i)) +
             QStringLiteral("</span>");
      i = j;
      continue;
    }
    if (c == QLatin1Char('-') && i + 1 < n && code[i + 1] == QLatin1Char('-')) {
      int j = code.indexOf(QLatin1Char('\n'), i);
      if (j < 0) j = n;
      out += QStringLiteral("<span style=\"color:#8b949e\">") + esc(code.mid(i, j - i)) +
             QStringLiteral("</span>");
      i = j;
      continue;
    }
    if (c.isDigit() || (c == QLatin1Char('.') && i + 1 < n && code[i + 1].isDigit())) {
      int j = i;
      bool dot = false;
      while (j < n && (code[j].isLetterOrNumber() || code[j] == QLatin1Char('_') ||
                       code[j] == QLatin1Char('.') || code[j] == QLatin1Char('x') ||
                       code[j] == QLatin1Char('X'))) {
        if (code[j] == QLatin1Char('.')) {
          if (dot) break;
          dot = true;
        }
        ++j;
      }
      out += QStringLiteral("<span style=\"color:#79c0ff\">") + esc(code.mid(i, j - i)) +
             QStringLiteral("</span>");
      i = j;
      continue;
    }
    if (isWordChar(c)) {
      int j = i;
      while (j < n && isWordChar(code[j])) ++j;
      flushWord(code.mid(i, j - i));
      i = j;
      continue;
    }
    out += esc(c);
    ++i;
  }
  if (inBlock) out += QStringLiteral("</span>");
  return out;
}

QString parseInline(QString s) {
  // Inline code spans first, protected by placeholders.
  QStringList codeSpans;
  QString out;
  int i = 0;
  const int n = s.size();
  while (i < n) {
    if (s[i] == QLatin1Char('`')) {
      int ticks = 0;
      while (i + ticks < n && s[i + ticks] == QLatin1Char('`')) ++ticks;
      const QString fence = QString(ticks, QLatin1Char('`'));
      const int close = s.indexOf(fence, i + ticks);
      if (close >= 0) {
        const QString inner = s.mid(i + ticks, close - i - ticks);
        codeSpans.push_back(QStringLiteral("<span style=\"color:#e5a87f\">") + esc(inner) +
                            QStringLiteral("</span>"));
        out += QStringLiteral("\ue000%1\ue001").arg(codeSpans.size() - 1);
        i = close + ticks;
        continue;
      }
    }
    out += s[i];
    ++i;
  }
  out = esc(out);
  // Links [text](url).
  {
    QString r;
    int p = 0;
    while (p < out.size()) {
      const int lb = out.indexOf(QLatin1Char('['), p);
      if (lb < 0) {
        r += out.mid(p);
        break;
      }
      const int rb = out.indexOf(QLatin1Char(']'), lb);
      const int lp = rb >= 0 ? out.indexOf(QLatin1Char('('), rb) : -1;
      const int rp = lp >= 0 ? out.indexOf(QLatin1Char(')'), lp) : -1;
      if (rb < 0 || lp != rb + 1 || rp < 0) {
        r += out.mid(p, lb - p + 1);
        p = lb + 1;
        continue;
      }
      r += out.mid(p, lb - p);
      const QString text = out.mid(lb + 1, rb - lb - 1);
      const QString url = out.mid(lp + 1, rp - lp - 1);
      r += QStringLiteral("<a href=\"%1\"><span style=\"color:#6ea8dc\">%2</span></a>")
               .arg(url, text);
      p = rp + 1;
    }
    out = r;
  }
  // Bare URLs.
  {
    QString r;
    int p = 0;
    while (p < out.size()) {
      int u = out.indexOf(QStringLiteral("http://"), p);
      const int u2 = out.indexOf(QStringLiteral("https://"), p);
      if (u2 >= 0 && (u < 0 || u2 < u)) u = u2;
      if (u < 0) {
        r += out.mid(p);
        break;
      }
      if (u > 0 && out[u - 1] == QLatin1Char('"')) {
        r += out.mid(p, u - p + 1);
        p = u + 1;
        continue;
      }
      int e = u;
      while (e < out.size() && !out[e].isSpace() && out[e] != QLatin1Char('<')) ++e;
      while (e > u && QStringLiteral(".,;:!?)").contains(out[e - 1])) --e;
      r += out.mid(p, u - p);
      const QString url = out.mid(u, e - u);
      r += QStringLiteral("<a href=\"%1\"><span style=\"color:#6ea8dc\">%1</span></a>").arg(url);
      p = e;
    }
    out = r;
  }
  // Bold + italic.
  out.replace(QRegularExpression(QStringLiteral("\\*\\*(.+?)\\*\\*")),
              QStringLiteral("<b>\\1</b>"));
  out.replace(QRegularExpression(QStringLiteral("__(.+?)__")), QStringLiteral("<b>\\1</b>"));
  out.replace(QRegularExpression(QStringLiteral("\\*(.+?)\\*")), QStringLiteral("<i>\\1</i>"));
  out.replace(QRegularExpression(QStringLiteral("(?<!\\w)_(.+?)_(?!\\w)")),
              QStringLiteral("<i>\\1</i>"));
  // Restore code spans.
  for (int k = 0; k < codeSpans.size(); ++k)
    out.replace(QStringLiteral("\ue000%1\ue001").arg(k), codeSpans[k]);
  return out;
}

QStringList splitRow(const QString& line) {
  QString t = line.trimmed();
  if (t.startsWith(QLatin1Char('|'))) t = t.mid(1);
  if (t.endsWith(QLatin1Char('|'))) t.chop(1);
  QStringList cells;
  QString cur;
  bool inCode = false;
  for (int i = 0; i < t.size(); ++i) {
    const QChar c = t[i];
    if (c == QLatin1Char('`')) inCode = !inCode;
    if (c == QLatin1Char('|') && !inCode) {
      cells.push_back(cur.trimmed());
      cur.clear();
    } else {
      cur += c;
    }
  }
  cells.push_back(cur.trimmed());
  return cells;
}

bool isDelimRow(const QString& line) {
  const QStringList cells = splitRow(line);
  if (cells.isEmpty()) return false;
  for (const QString& c : cells) {
    QString t = c.trimmed();
    if (t.size() < 3) return false;
    int dash = 0;
    for (const QChar ch : t) {
      if (ch == QLatin1Char('-'))
        ++dash;
      else if (ch != QLatin1Char(':'))
        return false;
    }
    if (dash == 0) return false;
  }
  return true;
}

}  // namespace

QString renderMarkdownHtml(const QString& md, const QString& fontFamily, int fontSize) {
  const QStringList lines = md.split(QLatin1Char('\n'));
  QString body;
  int i = 0;
  const int n = lines.size();

  while (i < n) {
    const QString line = lines[i];
    const QString t = line.trimmed();
    if (t.isEmpty()) {
      ++i;
      continue;
    }
    // Fenced code.
    if (t.startsWith(QStringLiteral("```")) || t.startsWith(QStringLiteral("~~~"))) {
      const QString fence = t.startsWith(QStringLiteral("```")) ? QStringLiteral("```")
                                                                : QStringLiteral("~~~");
      const QString lang = t.mid(3).trimmed().split(QLatin1Char(' ')).first().toLower();
      QString code;
      ++i;
      while (i < n && !lines[i].trimmed().startsWith(fence)) {
        code += lines[i] + QLatin1Char('\n');
        ++i;
      }
      if (i < n) ++i;
      if (code.endsWith(QLatin1Char('\n'))) code.chop(1);
      body += QStringLiteral(
                  "<table width=\"100%\" border=\"1\" bordercolor=\"#383634\" cellpadding=\"0\" "
                  "cellspacing=\"0\"><tr><td "
                  "bgcolor=\"#141414\">");
      if (!lang.isEmpty())
        body += QStringLiteral("<p style=\"color:#716c65; font-size:11px\">") + esc(lang) +
                QStringLiteral("</p>");
      body += QStringLiteral("<pre style=\"color:#e6e6e6; font-size:13px\">") +
              highlightCode(code) + QStringLiteral("</pre></td></tr></table>");
      continue;
    }
    // Headings.
    if (t.startsWith(QLatin1Char('#'))) {
      int level = 0;
      while (level < (int)t.size() && t[level] == QLatin1Char('#')) ++level;
      level = qMin(level, 4);
      QString text = t.mid(level).trimmed();
      const int px[4] = {22, 19, 17, 15};
      body += QStringLiteral("<h%1 style=\"color:#e8e6e2; font-size:%2px\">%3</h%1>")
                  .arg(level)
                  .arg(px[level - 1])
                  .arg(parseInline(text));
      ++i;
      continue;
    }
    // Horizontal rule.
    if (t == QStringLiteral("---") || t == QStringLiteral("***") ||
        t == QStringLiteral("___")) {
      body += QStringLiteral("<hr/>");
      ++i;
      continue;
    }
    // Tables.
    if (t.contains(QLatin1Char('|')) && i + 1 < n && isDelimRow(lines[i + 1])) {
      const QStringList head = splitRow(t);
      const QStringList delim = splitRow(lines[i + 1]);
      QVector<QString> aligns;
      for (const QString& d : delim) {
        const QString c = d.trimmed();
        if (c.startsWith(QLatin1Char(':')) && c.endsWith(QLatin1Char(':')))
          aligns.push_back(QStringLiteral("center"));
        else if (c.endsWith(QLatin1Char(':')))
          aligns.push_back(QStringLiteral("right"));
        else
          aligns.push_back(QStringLiteral("left"));
      }
      i += 2;
      body += QStringLiteral(
          "<table width=\"100%\" border=\"1\" bordercolor=\"#383634\" cellspacing=\"0\" "
          "cellpadding=\"6\">"
          "<tr bgcolor=\"#222120\">");
      for (int c = 0; c < head.size(); ++c)
        body += QStringLiteral("<th align=\"%1\"><span style=\"color:#e8e6e2\">%2</span></th>")
                    .arg(c < aligns.size() ? aligns[c] : QStringLiteral("left"),
                         parseInline(head[c]));
      body += QStringLiteral("</tr>");
      while (i < n && lines[i].trimmed().contains(QLatin1Char('|')) &&
             !lines[i].trimmed().isEmpty()) {
        const QStringList cells = splitRow(lines[i]);
        body += QStringLiteral("<tr>");
        for (int c = 0; c < head.size(); ++c) {
          const QString cell = c < cells.size() ? cells[c] : QString();
          body += QStringLiteral("<td align=\"%1\"><span style=\"color:#e8e6e2\">%2</span></td>")
                      .arg(c < aligns.size() ? aligns[c] : QStringLiteral("left"),
                           parseInline(cell));
        }
        body += QStringLiteral("</tr>");
        ++i;
      }
      body += QStringLiteral("</table>");
      continue;
    }
    // Blockquotes.
    if (t.startsWith(QLatin1Char('>'))) {
      QStringList qs;
      while (i < n && lines[i].trimmed().startsWith(QLatin1Char('>'))) {
        QString q = lines[i].trimmed().mid(1);
        if (q.startsWith(QLatin1Char(' '))) q = q.mid(1);
        qs.push_back(q);
        ++i;
      }
      QStringList rendered;
      for (const QString& q : qs)
        rendered.push_back(QStringLiteral("<span style=\"color:#4d4a46\">▌</span> ") +
                           parseInline(q));
      body += QStringLiteral("<p style=\"color:#a8a29a\">") +
              rendered.join(QStringLiteral("<br/>")) + QStringLiteral("</p>");
      continue;
    }
    // Lists (one nesting level).
    auto isBullet = [&](const QString& s) {
      return s.startsWith(QStringLiteral("- ")) || s.startsWith(QStringLiteral("* ")) ||
             s.startsWith(QStringLiteral("+ "));
    };
    auto isOrdered = [&](const QString& s) {
      int d = 0;
      while (d < (int)s.size() && s[d].isDigit()) ++d;
      return d > 0 && d < (int)s.size() && s[d] == QLatin1Char('.') &&
             (d + 1 >= (int)s.size() || s[d + 1].isSpace());
    };
    if (isBullet(t) || isOrdered(t)) {
      const bool ordered = isOrdered(t);
      body += ordered ? QStringLiteral("<ol>") : QStringLiteral("<ul>");
      while (i < n) {
        const QString lt = lines[i].trimmed();
        if (!isBullet(lt) && !isOrdered(lt)) break;
        QString item;
        if (isBullet(lt))
          item = lt.mid(2);
        else {
          int d = 0;
          while (d < (int)lt.size() && lt[d].isDigit()) ++d;
          item = lt.mid(d + 1).trimmed();
        }
        // Task list checkboxes.
        QString box;
        if (item.startsWith(QStringLiteral("[ ] "))) {
          box = QStringLiteral("☐ ");
          item = item.mid(4);
        } else if (item.startsWith(QStringLiteral("[x] ")) ||
                   item.startsWith(QStringLiteral("[X] "))) {
          box = QStringLiteral("☑ ");
          item = item.mid(4);
        }
        // Nested single level.
        QString nested;
        int j = i + 1;
        while (j < n && (lines[j].startsWith(QStringLiteral("  ")) ||
                         lines[j].startsWith(QLatin1Char('\t')))) {
          const QString nt = lines[j].trimmed();
          if (isBullet(nt) || isOrdered(nt)) {
            if (nested.isEmpty()) nested = QStringLiteral("<ul>");
            QString ni = isBullet(nt) ? nt.mid(2) : nt;
            nested += QStringLiteral("<li><span style=\"color:#e8e6e2\">") + parseInline(ni) +
                      QStringLiteral("</span></li>");
          } else if (!nt.isEmpty()) {
            nested += parseInline(nt);
          }
          ++j;
        }
        if (!nested.isEmpty()) nested += QStringLiteral("</ul>");
        body += QStringLiteral("<li><span style=\"color:#e8e6e2\">") + box + parseInline(item) +
                QStringLiteral("</span>") + nested + QStringLiteral("</li>");
        i = (j > i + 1) ? j : i + 1;
      }
      body += ordered ? QStringLiteral("</ol>") : QStringLiteral("</ul>");
      continue;
    }
    // Paragraph.
    {
      QStringList ps;
      while (i < n && !lines[i].trimmed().isEmpty() &&
             !lines[i].trimmed().startsWith(QLatin1Char('#')) &&
             !lines[i].trimmed().startsWith(QStringLiteral("```")) &&
             !lines[i].trimmed().startsWith(QStringLiteral("~~~")) &&
             !lines[i].trimmed().startsWith(QLatin1Char('>'))) {
        const QString lt = lines[i].trimmed();
        if ((lt.contains(QLatin1Char('|')) && i + 1 < n && isDelimRow(lines[i + 1])) ||
            lt == QStringLiteral("---") || lt == QStringLiteral("***"))
          break;
        // Hard break: two trailing spaces.
        QString pl = lines[i];
        bool hardBreak = pl.endsWith(QStringLiteral("  "));
        ps.push_back(parseInline(lines[i].trimmed()) +
                       (hardBreak ? QStringLiteral("<br/>") : QString()));
        ++i;
      }
      body += QStringLiteral("<p style=\"color:#e8e6e2\">") + ps.join(QLatin1Char(' ')) +
              QStringLiteral("</p>");
      continue;
    }
  }

  const QString fam = fontFamily.isEmpty() ? QStringLiteral("sans-serif") : fontFamily;
  return QStringLiteral(
             "<html><head><meta charset=\"utf-8\"/></head>"
             "<body style=\"font-family:'%1'; font-size:%2px; color:#e8e6e2; "
             "line-height:150%; margin:0;\">%3</body></html>")
      .arg(esc(fam), QString::number(fontSize), body);
}

}  // namespace omnia
