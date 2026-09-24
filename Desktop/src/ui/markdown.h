#pragma once

#include <QString>

namespace omnia {

// Renders GitHub-style markdown to a Qt rich-text HTML fragment tuned for the
// dark Omnia theme: headings, fenced code with highlighting, tables,
// blockquotes, lists, links, inline code, bold/italic.
QString renderMarkdownHtml(const QString& md, const QString& fontFamily, int fontSize);

}  // namespace omnia
