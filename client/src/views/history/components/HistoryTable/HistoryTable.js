import React from "react";
import MaterialTable from "material-table";
import { MuiThemeProvider, createMuiTheme } from "@material-ui/core";
import { Header } from "semantic-ui-react";

const theme = createMuiTheme({
  palette: {
    primary: {
      main: "rgb(111, 156, 235)"
    },
    secondary: {
      main: "rgb(111, 156, 235)"
    }
  }
});

function HistoryTable(props) {
  return (
    <MuiThemeProvider theme={theme}>
      <MaterialTable
        title={<Header as="h1">History</Header>}
        columns={[
          {
            title: "Title",
            field: "title"
          },
          {
            title: "URL",
            field: "url"
          },
          { title: "# Visits", field: "visit_count", type: "numeric" },
          { title: "# Typed", field: "typed_count", type: "numeric" },
          { title: "Last Visit Time", field: "last_visit_time" },
          {
            title: "Visit Duration (sec.)",
            field: "visit_duration",
            type: "numeric"
          },
          { title: "Transition", field: "transition" }
        ]}
        data={props.history || []}
        actions={[
          {
            icon: "save",
            tooltip: "Mark as evidence",
            onClick: (event, rowData) =>
              props.setShowModal({
                show: true,
                data: rowData
              })
          }
        ]}
        options={{
          selection: true,
          exportButton: true,
          tableLayout: "fixed",
          cellStyle: { overflow: "hidden" },
          searchFieldAlignment: "right",
          searchFieldStyle: { width: "500px" },
          pageSize: 5
        }}
      />
    </MuiThemeProvider>
  );
}

export default HistoryTable;
