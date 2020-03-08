import React from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from "recharts";
import { Header, Segment } from "semantic-ui-react";
import _ from "lodash";

function AvgVisitChart(props) {
  return (
    <Segment color="blue">
      <Header as="h1">Avg. visit time duration for 5 most common sites</Header>
      <ResponsiveContainer height={200}>
        <BarChart
          data={_.orderBy(
            props.avgDurations,
            ["avg_visit_duration"],
            ["desc"]
          ).slice(0, 5)}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <YAxis dx={-20} />
          <XAxis dataKey="url" />
          <Tooltip />
          <Bar dataKey="avg_visit_duration" barSize={40} fill="#413ea0" />
        </BarChart>
      </ResponsiveContainer>
    </Segment>
  );
}

export default AvgVisitChart;
