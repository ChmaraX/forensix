import React, { useState } from "react";
import { Segment, Header, Button } from "semantic-ui-react";
import ReactTooltip from "react-tooltip";
import CalendarHeatmap from "react-calendar-heatmap";
import "react-calendar-heatmap/dist/styles.css";
import "./react-calendar-heatmap.css";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from "recharts";

function shiftDate(date, numDays) {
  const newDate = new Date(date);
  newDate.setDate(newDate.getDate() + numDays);
  return newDate;
}

const heatmap = bActivity => (
  <React.Fragment style={{ marginTop: "50px !important" }}>
    <CalendarHeatmap
      style={{ marginTop: "50px" }}
      startDate={shiftDate(new Date(), -365)}
      endDate={new Date()}
      values={bActivity?.byDate || []}
      tooltipDataAttrs={value => {
        return {
          "data-tip": `${value.date?.toString().slice(0, 10)} has count: ${
            value.visits
          }`
        };
      }}
      classForValue={value => {
        if (!value) {
          return "color-empty";
        }
        return `color-gitlab-${value.visits % 5}`;
      }}
    />
    <ReactTooltip />
  </React.Fragment>
);

const barchart = bActivity => (
  <ResponsiveContainer width={900} height={220}>
    <BarChart data={bActivity?.byMonth}>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey="month" />
      <YAxis />
      <Tooltip />
      <Bar dataKey="visits" barSize={40} fill="#413ea0" />
    </BarChart>
  </ResponsiveContainer>
);

function BrowsingActivty(props) {
  const [showHeatmap, setShowHeatmap] = useState(true);

  return (
    <Segment padded raised color="blue">
      <Header
        as="h1"
        content="Browsing Activity"
        style={{ display: "inline-block" }}
        subheader={`number of visited urls ${
          showHeatmap
            ? "in each day (past year from now)"
            : "in each month (from last history record and year back)"
        }`}
      />
      <Button
        disabled={props.onlyHeatmap}
        primary
        onClick={() => setShowHeatmap(!showHeatmap)}
        style={{ float: "right" }}
      >
        Show {showHeatmap ? "Barchart" : "Heatmap"}
      </Button>
      {showHeatmap ? heatmap(props.bActivity) : barchart(props.bActivity)}
    </Segment>
  );
}

export default BrowsingActivty;
