import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

// ── Parse markdown-ish report into structured sections ───────────

interface ReportSection {
  type: 'title' | 'heading' | 'subheading' | 'paragraph' | 'table' | 'list' | 'bold_line'
  text?: string
  rows?: string[][]
  headers?: string[]
  items?: string[]
}

function parseReport(markdown: string): ReportSection[] {
  const sections: ReportSection[] = []
  const lines = markdown.split('\n')
  let i = 0

  while (i < lines.length) {
    const line = lines[i].trim()

    if (!line) { i++; continue }

    // H1
    if (line.startsWith('# ')) {
      sections.push({ type: 'title', text: line.replace(/^#+\s*/, '') })
      i++; continue
    }
    // H2
    if (line.startsWith('## ')) {
      sections.push({ type: 'heading', text: line.replace(/^#+\s*/, '') })
      i++; continue
    }
    // H3
    if (line.startsWith('### ')) {
      sections.push({ type: 'subheading', text: line.replace(/^#+\s*/, '') })
      i++; continue
    }
    // Numbered heading like "1. Executive Summary"
    if (/^\d+\.\s+[A-Z]/.test(line) && line.length < 80) {
      sections.push({ type: 'heading', text: line })
      i++; continue
    }

    // Table (starts with |)
    if (line.startsWith('|')) {
      const tableLines: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i].trim())
        i++
      }
      const parsed = tableLines
        .filter(l => !l.match(/^\|[\s\-:|]+\|$/))
        .map(l => l.split('|').slice(1, -1).map(c => c.trim()))
      if (parsed.length > 0) {
        sections.push({
          type: 'table',
          headers: parsed[0],
          rows: parsed.slice(1),
        })
      }
      continue
    }

    // List items
    if (line.startsWith('- ') || line.startsWith('* ')) {
      const items: string[] = []
      while (i < lines.length && (lines[i].trim().startsWith('- ') || lines[i].trim().startsWith('* '))) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ''))
        i++
      }
      sections.push({ type: 'list', items })
      continue
    }

    // Bold line (like **Key Finding:**)
    if (line.startsWith('**') && line.includes(':**')) {
      sections.push({ type: 'bold_line', text: line.replace(/\*\*/g, '') })
      i++; continue
    }

    // Regular paragraph
    let para = line
    i++
    while (i < lines.length && lines[i].trim() && !lines[i].trim().startsWith('#') && !lines[i].trim().startsWith('|') && !lines[i].trim().startsWith('- ') && !/^\d+\.\s+[A-Z]/.test(lines[i].trim())) {
      para += ' ' + lines[i].trim()
      i++
    }
    sections.push({ type: 'paragraph', text: para.replace(/\*\*/g, '') })
  }

  return sections
}

// ── Generate professional PDF ────────────────────────────────────

export function generatePDF(
  report: string,
  audit?: { quality_score?: number; verdict?: string; summary?: string },
) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const marginL = 20
  const marginR = 20
  const contentW = pageW - marginL - marginR
  let y = 0

  const addPage = () => { doc.addPage(); y = 25 }
  const checkPage = (needed: number) => { if (y + needed > pageH - 20) addPage() }

  // ── Cover header ──────────────────────────────────
  // Blue accent bar
  doc.setFillColor(59, 130, 246)
  doc.rect(0, 0, pageW, 40, 'F')

  // Title
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(22)
  doc.setFont('helvetica', 'bold')
  doc.text('AI Workforce Swarm', marginL, 18)

  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text('Intelligence Report', marginL, 26)

  // Date + quality on right
  doc.setFontSize(9)
  doc.text(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), pageW - marginR, 18, { align: 'right' })

  if (audit?.quality_score) {
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    const scoreText = `Quality: ${audit.quality_score}/100`
    doc.text(scoreText, pageW - marginR, 26, { align: 'right' })

    // Verdict badge
    if (audit.verdict) {
      const badgeColor = audit.verdict === 'approved' ? [34, 197, 94] : [234, 179, 8]
      doc.setFillColor(badgeColor[0], badgeColor[1], badgeColor[2])
      const tw = doc.getTextWidth(audit.verdict.toUpperCase()) + 6
      doc.roundedRect(pageW - marginR - tw, 29, tw, 6, 1.5, 1.5, 'F')
      doc.setFontSize(7)
      doc.setTextColor(255, 255, 255)
      doc.text(audit.verdict.toUpperCase(), pageW - marginR - tw + 3, 33.5)
    }
  }

  // Thin accent line
  doc.setDrawColor(59, 130, 246)
  doc.setLineWidth(0.5)
  doc.line(marginL, 42, pageW - marginR, 42)

  y = 52
  doc.setTextColor(30, 30, 30)

  // ── Parse and render sections ────────────────────
  const sections = parseReport(report)

  for (const sec of sections) {
    switch (sec.type) {
      case 'title': {
        checkPage(16)
        doc.setFontSize(18)
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(20, 20, 20)
        const titleLines = doc.splitTextToSize(sec.text!, contentW)
        doc.text(titleLines, marginL, y)
        y += titleLines.length * 8 + 2
        // Underline
        doc.setDrawColor(59, 130, 246)
        doc.setLineWidth(0.8)
        doc.line(marginL, y, marginL + 40, y)
        y += 8
        break
      }
      case 'heading': {
        checkPage(14)
        y += 4
        doc.setFontSize(13)
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(30, 60, 120)
        const hLines = doc.splitTextToSize(sec.text!, contentW)
        doc.text(hLines, marginL, y)
        y += hLines.length * 6 + 4
        // Small line
        doc.setDrawColor(200, 200, 220)
        doc.setLineWidth(0.3)
        doc.line(marginL, y - 2, marginL + 30, y - 2)
        break
      }
      case 'subheading': {
        checkPage(10)
        y += 2
        doc.setFontSize(11)
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(60, 60, 80)
        doc.text(sec.text!, marginL, y)
        y += 7
        break
      }
      case 'bold_line': {
        checkPage(8)
        doc.setFontSize(10)
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(30, 30, 30)
        const bl = doc.splitTextToSize(sec.text!, contentW)
        doc.text(bl, marginL, y)
        y += bl.length * 5 + 3
        break
      }
      case 'paragraph': {
        checkPage(12)
        doc.setFontSize(10)
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(50, 50, 50)
        const pLines = doc.splitTextToSize(sec.text!, contentW)
        for (let li = 0; li < pLines.length; li++) {
          checkPage(6)
          doc.text(pLines[li], marginL, y)
          y += 5
        }
        y += 3
        break
      }
      case 'list': {
        if (!sec.items) break
        doc.setFontSize(10)
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(50, 50, 50)
        for (const item of sec.items) {
          checkPage(8)
          // Bullet
          doc.setFillColor(59, 130, 246)
          doc.circle(marginL + 2, y - 1.2, 0.8, 'F')
          const itemLines = doc.splitTextToSize(item, contentW - 8)
          doc.text(itemLines, marginL + 6, y)
          y += itemLines.length * 5 + 2
        }
        y += 2
        break
      }
      case 'table': {
        if (!sec.headers || !sec.rows) break
        checkPage(20)
        autoTable(doc, {
          startY: y,
          head: [sec.headers],
          body: sec.rows,
          theme: 'grid',
          margin: { left: marginL, right: marginR },
          headStyles: {
            fillColor: [59, 130, 246],
            textColor: [255, 255, 255],
            fontStyle: 'bold',
            fontSize: 8.5,
            cellPadding: 3,
          },
          bodyStyles: {
            fontSize: 8,
            textColor: [40, 40, 40],
            cellPadding: 2.5,
          },
          alternateRowStyles: { fillColor: [245, 247, 255] },
          styles: { lineColor: [200, 210, 230], lineWidth: 0.3 },
        })
        y = (doc as any).lastAutoTable.finalY + 8
        break
      }
    }
  }

  // ── Footer on each page ──────────────────────────
  const totalPages = (doc as any).internal.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    doc.setFontSize(7)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(150, 150, 150)
    doc.text(`AI Workforce Swarm — Generated ${new Date().toISOString().split('T')[0]}`, marginL, pageH - 8)
    doc.text(`Page ${p} of ${totalPages}`, pageW - marginR, pageH - 8, { align: 'right' })
    // Top line on non-first pages
    if (p > 1) {
      doc.setDrawColor(220, 220, 230)
      doc.setLineWidth(0.3)
      doc.line(marginL, 18, pageW - marginR, 18)
    }
  }

  doc.save('swarm-report.pdf')
}
