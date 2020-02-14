import React from "react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer
} from "recharts";
import { Segment, Header, Placeholder } from "semantic-ui-react";

const COLORS1 = [
  "#421f79",
  "#7a3d93",
  "#635f6d",
  "#93f2d7",
  "#9b5c2a",
  "#15b9ee",
  "#0f5997",
  "#409188"
];

const COLORS2 = [
  "#1bede6",
  "#8798a4",
  "#d7790f",
  "#b2c24f",
  "#de73c2",
  "#d70a9c",
  "#25b67"
];

const PlaceholderImage = () => (
  <Placeholder fluid>
    <Placeholder.Image style={{ height: "240px" }} />
  </Placeholder>
);

function LoginPie(props) {
  return (
    <Segment padded raised color="blue" style={{ height: "330px" }}>
      <Header as="h1" content="Login Data Frequency" />
      {props.credentials ? (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between"
          }}
        >
          <ResponsiveContainer width={250} height={250}>
            <PieChart>
              <Pie
                data={props.credentials?.usernames}
                dataKey="count"
                nameKey="username_value"
                outerRadius={60}
                fill="#8884d8"
              >
                {props.credentials?.usernames.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={COLORS1[index % COLORS1.length]}
                  />
                ))}
              </Pie>
              <Pie
                data={props.credentials?.emails}
                dataKey="count"
                nameKey="username_value"
                innerRadius={70}
                outerRadius={90}
                fill="#82ca9d"
                label
              >
                {props.credentials?.emails.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={COLORS2[index % COLORS2.length]}
                  />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
          <div>
            <Header
              as="h4"
              content="Most used emails"
              style={{ marginBottom: "5px" }}
            />
            <Legend
              layout="vertical"
              wrapperStyle={{
                position: "relative !important"
              }}
              height={50}
              payload={props.credentials?.emails
                .map((entry, index) => ({
                  value: `${Math.round(
                    (entry.count / props.credentials.totalEmails) * 100
                  )}% ${entry.username_value}`,
                  type: "circle",
                  color: COLORS2[index % COLORS2.length]
                }))
                .slice(0, 3)}
            />
            <Header
              as="h4"
              content="Most used usernames"
              style={{ marginTop: "0", marginTop: "20px", marginBottom: "5px" }}
            />
            <Legend
              layout="vertical"
              wrapperStyle={{
                position: "relative !important",
                overflow: "hidden"
              }}
              payload={props.credentials?.usernames
                .map((entry, index) => ({
                  value: `${Math.round(
                    (entry.count / props.credentials.totalUsernames) * 100
                  )}% ${entry.username_value}`,
                  type: "circle",
                  color: COLORS1[index % COLORS1.length]
                }))
                .slice(0, 5)}
            />
          </div>
        </div>
      ) : (
        PlaceholderImage()
      )}
    </Segment>
  );
}

export default LoginPie;
