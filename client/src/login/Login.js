import React, { useState } from "react";
import "./Login.css";
import { Segment, Divider, Button, Form, Input } from "semantic-ui-react";
import Logo from "../common/Logo/Logo";
import CenteredWrapper from "../layout/CenteredWrapper/CenteredWrapper";
import { useDispatch } from "react-redux";
import { auth } from "../store/actions/auth";

function Login() {
  const dispatch = useDispatch();
  const [loginData, setLoginData] = useState({
    username: "",
    password: ""
  });

  const handleSubmit = () => {
    dispatch(auth(loginData.username, loginData.password));
  };

  const handleChange = (e, { name, value }) => {
    setLoginData({ ...loginData, [name]: value });
  };

  return (
    <CenteredWrapper>
      <Segment raised inverted className="black-base">
        <div className="left-box">
          <Logo />
          <br />
          <p>
            Bachelor thesis project by Adam Chmara <br />
            Slovak University of Technology in Bratislava <br />
            Faculty of Informatics and Information Technologies
          </p>
          <Divider horizontal inverted section>
            Don't have an account yet?
          </Divider>
          <Button inverted size="big">
            Click to login
          </Button>
        </div>
      </Segment>
      <Segment raised className="form-panel">
        <h1>Sign In</h1>
        <br />
        <Form onSubmit={handleSubmit}>
          <Form.Field>
            <label>Username</label>
            <Input
              name="username"
              icon="user"
              placeholder="Username"
              onChange={handleChange}
            />
          </Form.Field>
          <Form.Field>
            <label>Password</label>
            <Input
              name="password"
              type="password"
              icon="key"
              placeholder="******"
              onChange={handleChange}
            />
          </Form.Field>
          <br />
          <Button fluid size="big" type="submit" className="login-button">
            Sign In
          </Button>
        </Form>
      </Segment>
    </CenteredWrapper>
  );
}

export default Login;
