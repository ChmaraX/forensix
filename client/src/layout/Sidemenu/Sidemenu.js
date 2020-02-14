import React, { useState } from "react";
import Logo from "../../common/Logo/Logo";
import "./Sidemenu.css";
import { Icon } from "semantic-ui-react";

const nav = [
  {
    title: "Dashboard",
    icon: "dashboard"
  },
  {
    title: "History",
    icon: "circle"
  }
];

function Sidemenu() {
  const [selected, setSelected] = useState(0);

  return (
    <div className="sidemenu">
      <div className="logo">
        <Logo color="#6F9CEB" />
      </div>
      <div className="nav">
        {nav.map((el, i) => (
          <div
            key={i}
            onClick={() => setSelected(i)}
            className={`item ${selected === i ? "selected" : null}`}
          >
            <p>
              <Icon name={el.icon} />
              &nbsp;
              {el.title}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default Sidemenu;
