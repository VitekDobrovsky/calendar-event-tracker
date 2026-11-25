// ===================== CONFIG =====================

const calendarId = "YOUR_CALENDAR_ID"

// --- Notion ---
// Database ID = the 32-char hex string in the database URL.
// The integration token is NOT stored here: put it in
// Project Settings -> Script Properties as NOTION_TOKEN.
const NOTION_DATABASE_ID = "YOUR_NOTION_DB_ID"
const SYNC_TO_NOTION = true

// --- Google Sheet (legacy) ---
// Set to false once you no longer need the spreadsheet.
const SYNC_TO_SHEET = true
const spreadsheetId = "YOUR_SPREADSHEET_ID"
const sheetName = "YOUR_SHEET_NAME"

// How far back the first (full) sync looks, in days.
const INITIAL_SYNC_DAYS = 7

// Notion property names (must match the database columns exactly).
const PROP = {
  title: "Název",
  project: "Projekt",
  date: "Datum",
  duration: "Délka (h)",
  eventId: "Event ID",
}

const NOTION_VERSION = "2022-06-28"
const SYNC_TOKEN_KEY = "syncTokenV2"


// ===================== MAIN SYNC =====================

// Run by the time-driven trigger every 5 minutes.
function syncCalendarEvents() {
  const properties = PropertiesService.getUserProperties()
  let syncToken = properties.getProperty(SYNC_TOKEN_KEY)
  let changedEvents = []
  let pageToken = null

  const baseOptions = () => {
    // singleEvents: recurring events come as individual occurrences
    let o = { maxResults: 250, singleEvents: true, showDeleted: true }
    if (syncToken) o.syncToken = syncToken
    else o.timeMin = new Date(Date.now() - INITIAL_SYNC_DAYS * 24 * 60 * 60 * 1000).toISOString()
    return o
  }

  while (true) {
    let options = baseOptions()
    if (pageToken) options.pageToken = pageToken
    try {
      const response = Calendar.Events.list(calendarId, options)
      if (response.items) changedEvents = changedEvents.concat(response.items)
      pageToken = response.nextPageToken
      if (!pageToken) {
        syncToken = response.nextSyncToken
        break
      }
    } catch (e) {
      if (syncToken && /sync token/i.test(e.message)) {
        // Invalid / expired sync token: start over with a full sync
        console.log("Sync token invalid, doing a full sync.")
        properties.deleteProperty(SYNC_TOKEN_KEY)
        syncToken = null
        pageToken = null
        changedEvents = []
        continue
      }
      console.log("Error syncing calendar: " + e.message)
      return
    }
  }

  if (changedEvents.length === 0) {
    console.log("No changes detected in the calendar.")
    if (syncToken) properties.setProperty(SYNC_TOKEN_KEY, syncToken)
    return
  }

  console.log(changedEvents.length + " changed event(s).")

  if (SYNC_TO_NOTION) {
    // If this throws, the sync token is not saved, so the same changes
    // are retried on the next run.
    syncEventsToNotion(changedEvents)
  }

  if (syncToken) properties.setProperty(SYNC_TOKEN_KEY, syncToken)

  if (SYNC_TO_SHEET) {
    transferActivitiesToSheet()
  }
}

// Run once manually: removes old triggers, creates the 5-minute trigger
// and does the first sync.
function setupCalendarTrigger() {
  ScriptApp.getProjectTriggers().forEach(trigger => ScriptApp.deleteTrigger(trigger))

  ScriptApp.newTrigger('syncCalendarEvents')
    .timeBased()
    .everyMinutes(5)
    .create()

  syncCalendarEvents()
}

// Run manually to forget the sync token; the next run does a full sync
// of the last INITIAL_SYNC_DAYS days (existing Notion rows are updated,
// not duplicated).
function resetSync() {
  PropertiesService.getUserProperties().deleteProperty(SYNC_TOKEN_KEY)
  console.log("Sync token cleared.")
}


// ===================== NOTION =====================

function syncEventsToNotion(events) {
  for (let event of events) {
    const pageId = findNotionPageByEventId(event.id)

    // deleted / cancelled event -> archive the row
    if (event.status === "cancelled") {
      if (pageId) {
        notionRequest("patch", "/pages/" + pageId, { archived: true })
        console.log("Archived: " + event.id)
      }
      continue
    }

    // all-day events have no duration in hours -> don't track them
    if (!event.start || !event.start.dateTime) {
      if (pageId) notionRequest("patch", "/pages/" + pageId, { archived: true })
      continue
    }

    const props = buildNotionProperties(event)

    if (pageId) {
      notionRequest("patch", "/pages/" + pageId, { properties: props })
      console.log("Updated: " + (event.summary || ""))
    } else {
      notionRequest("post", "/pages", {
        parent: { database_id: NOTION_DATABASE_ID },
        properties: props,
      })
      console.log("Created: " + (event.summary || ""))
    }
  }
}

function buildNotionProperties(event) {
  const title = (event.summary || "(bez názvu)").trim()
  const start = new Date(event.start.dateTime)
  const end = new Date(event.end.dateTime)
  const hours = Math.round(((end - start) / (1000 * 60 * 60)) * 100) / 100

  // Project = lowercased title, same as the sheet columns.
  // Notion select options cannot contain commas.
  const project = title.toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ").trim().substring(0, 100)

  return {
    [PROP.title]: { title: [{ text: { content: title } }] },
    [PROP.project]: { select: { name: project } },
    [PROP.date]: { date: { start: event.start.dateTime, end: event.end.dateTime } },
    [PROP.duration]: { number: hours },
    [PROP.eventId]: { rich_text: [{ text: { content: event.id } }] },
  }
}

function findNotionPageByEventId(eventId) {
  const res = notionRequest("post", "/databases/" + NOTION_DATABASE_ID + "/query", {
    filter: { property: PROP.eventId, rich_text: { equals: eventId } },
    page_size: 1,
  })
  return res.results && res.results.length > 0 ? res.results[0].id : null
}

function notionRequest(method, path, body) {
  const token = PropertiesService.getScriptProperties().getProperty("NOTION_TOKEN")
  if (!token) throw new Error("Missing NOTION_TOKEN in Script Properties.")

  const options = {
    method: method,
    contentType: "application/json",
    headers: {
      Authorization: "Bearer " + token,
      "Notion-Version": NOTION_VERSION,
    },
    muteHttpExceptions: true,
  }
  if (body) options.payload = JSON.stringify(body)

  // Notion allows ~3 requests/second; retry on 429 / 5xx.
  for (let attempt = 0; attempt < 4; attempt++) {
    Utilities.sleep(350)
    const response = UrlFetchApp.fetch("https://api.notion.com/v1" + path, options)
    const code = response.getResponseCode()
    if (code >= 200 && code < 300) return JSON.parse(response.getContentText())
    if (code === 429 || code >= 500) {
      Utilities.sleep(1000 * Math.pow(2, attempt))
      continue
    }
    throw new Error("Notion API " + code + ": " + response.getContentText())
  }
  throw new Error("Notion API: too many retries for " + path)
}

// Run manually to check that the token and database access work.
function testNotionConnection() {
  const db = notionRequest("get", "/databases/" + NOTION_DATABASE_ID)
  console.log("OK, connected to database: " + db.title.map(t => t.plain_text).join(""))
}


// ===================== GOOGLE SHEET (legacy) =====================

function transferActivitiesToSheet() {

  // get calendar
  let calendar = CalendarApp.getCalendarById(calendarId)

  // get events for today
  let now = new Date
  const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  let dayName = daysOfWeek[now.getDay()]
  let date = now.toLocaleDateString()
  date = resetDateFormat(date)
  let events = calendar.getEventsForDay(now)

  // write to duration sheet
  addDayToSheet(spreadsheetId, sheetName, events, dayName, date)
}

function addDayToSheet(spreadsheetId, sheetName, events, dayName, date, row) {

  // get sheet
  let spreadsheet = SpreadsheetApp.openById(spreadsheetId)
  let sheet = spreadsheet.getSheetByName(sheetName)

  // get row to write on
  let startRow = sheet.getLastRow() + 1

  // add indent when wrting first log
  if (startRow == 1) startRow += 1

  if (sheet.getRange(startRow - 1, 1).getValue() == dayName) {
    startRow = startRow - 1
  }

  // write day name and date
  sheet.getRange(startRow, 1).setValue(dayName)
  sheet.getRange(startRow, 2).setValue(date)

  // enumerate column headers
  let lastCol = sheet.getLastColumn()
  let headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
  let headerMap = {}
  headers.forEach((header, index) => {
    headerMap[header.toLowerCase()] = index + 1
  })

  // calculate total durration
  let eventsMap = {}
  for (let i = 0; i < events.length; i++) {
    let event = events[i]
    let title = event.getTitle().toLowerCase()
    let durration = (event.getEndTime() - event.getStartTime()) / (1000 * 60 * 60)

    if(eventsMap[title]) eventsMap[title] += durration
    else eventsMap[title] = durration
  }

  let eventsMapLength = Object.keys(eventsMap).length;

  // write events to sheet
  for (let i = 0; i < eventsMapLength; i++) {
    let title = Object.keys(eventsMap)[i];
    let value = eventsMap[title]

    // add header if it is missing
    if (!headerMap[title]) {
      lastCol++
      sheet.getRange(1, lastCol).setValue(title)
      headerMap[title] = lastCol
    }

    // write
    sheet.getRange(startRow, headerMap[title]).setValue(value)
  }
}

function resetDateFormat(date) {
  // 3/2/2024 -> 2.3.2024
  let dateParts = date.split("/")
  let newDate = dateParts[1] + "." + dateParts[0] + "." + dateParts[2]

  return newDate
}
