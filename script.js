// FILL IN YOUR INFORMATIONS -------------------------------------------------------------------------------------
const calendarId = "YOUR CALENDAR ID"
const spreadsheetId = "YOUR SPREADSHEET ID"
const sheetName = "YOUR SHEET NAME"
// ---------------------------------------------------------------------------------------------------------------


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

    // determine value based on sheet name
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
  // 3/2/2024
  //
  // 3.2.2025

  let dateParts = date.split("/")
  let newDate = dateParts[1] + "." + dateParts[0] + "." + dateParts[2]

  return newDate
}

// Sync function to detect changes in the specific calendar
function syncCalendarEvents() {
  const properties = PropertiesService.getUserProperties();
  let syncToken = properties.getProperty('syncToken');
  let options = { maxResults: 100 }; // Limit results per page

  if (syncToken) {
    options.syncToken = syncToken; // Incremental sync
  } else {
    // Full sync: Check events from the last 7 days
    options.timeMin = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  }

  let eventsChanged = false;
  let pageToken = null;

  do {
    options.pageToken = pageToken;
    try {
      const response = Calendar.Events.list(calendarId, options);
      if (response.items && response.items.length > 0) {
        eventsChanged = true; // Changes detected
      }
      syncToken = response.nextSyncToken; // Update sync token
      pageToken = response.nextPageToken; // Handle pagination
    } catch (e) {
      if (e.message.includes("Sync token")) {
        // Invalid sync token: Reset and do full sync
        properties.deleteProperty('syncToken');
        syncToken = null;
        options.timeMin = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        delete options.syncToken;
        continue;
      }
      console.log("Error syncing calendar: " + e.message);
      return;
    }
  } while (pageToken);

  // Store the new sync token
  if (syncToken) {
    properties.setProperty('syncToken', syncToken);
  }

  // Run the export if changes were detected
  if (eventsChanged) {
    console.log("Calendar changes detected. Running transferActivitiesToSheet().");
    transferActivitiesToSheet();
  } else {
    console.log("No changes detected in the calendar.");
  }
}

// Optional: Initial setup function to create the trigger
function setupCalendarTrigger() {
  // Delete existing triggers to avoid duplicates
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => ScriptApp.deleteTrigger(trigger));

  // Create a time-driven trigger to check every 5 minutes
  ScriptApp.newTrigger('syncCalendarEvents')
    .timeBased()
    .everyMinutes(5)
    .create();

  // Run once to initialize sync token
  syncCalendarEvents();
}
