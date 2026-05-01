import configparser
import os
from urllib.parse import parse_qs, urlparse

from .DMLocalClient import DMLocalClient, LocalApiError
from .ServerManager import DMLocalServerManager


class DMAPI:
    _shared_server_manager = None
    _shared_server_ref_count = 0

    SIGN_TYPE_UNSIGNED = 1
    SIGN_TYPE_SIGNED = 2
    SIGN_TYPE_SIGNOUT = 3
    SIGN_TYPE_LEAVE = 4

    CREDIT_URL_CANDIDATES = (
        "https://appdmkj.5idream.net/v2/activity/manager/credit/candidates"
    )
    CREDIT_URL_OTHERMEMS = (
        "https://appdmkj.5idream.net/v2/activity/manager/credit/other/mem"
    )
    CREDIT_URL_CREDITEDMEM = (
        "https://appdmkj.5idream.net/v2/activity/manager/credit/men"
    )

    EXPORT_TYPE_REGISTER = 1
    EXPORT_TYPE_ADMIT = 2
    EXPORT_TYPE_LEAVE = 3

    def login(self, account: str, pwd: str) -> bool:
        try:
            data = self._client.post(
                "/session/login",
                {"account": account, "pwd": pwd},
                operation="login",
            )
        except LocalApiError:
            return False

        self.uid = str(data.get("uid", ""))
        self.token = str(data.get("token", ""))
        self._save_login_config(
            uid=self.uid,
            token=self.token,
            account=account,
            pwd=pwd,
        )
        return bool(self.uid and self.token)

    def get_activityList(self, tribeId: str = "508956") -> bool:
        try:
            self._client.get(
                "/activities",
                {"tribeId": tribeId},
                operation="get_activityList",
            )
            return True
        except LocalApiError:
            return False

    def get_mime_manage_activity_dict(self) -> dict | None:
        try:
            return self._client.get(
                "/manage/activities",
                operation="get_mime_manage_activity_dict",
            )
        except LocalApiError:
            return None

    def get_signid(self, activityId: str) -> str | None:
        try:
            data = self._client.get(
                f"/sign/card/{activityId}",
                operation="get_signid",
            )
            return None if data is None else str(data)
        except LocalApiError:
            return None

    def resign(
        self, activityId: str, signUpId_list: list = [], is_all: bool = True
    ) -> bool:
        try:
            return bool(
                self._client.post(
                    "/sign/resign",
                    {
                        "activityId": activityId,
                        "signUpId_list": signUpId_list,
                        "is_all": is_all,
                    },
                    operation="resign",
                )
            )
        except LocalApiError:
            return False

    def get_creditType_list(self, activityId: str) -> list:
        try:
            return self._client.get(
                "/credit/types",
                {"activityId": activityId},
                operation="get_creditType_list",
            )
        except LocalApiError:
            return None

    def get_creditType_list2(self, activityId: str) -> list:
        try:
            return self._client.get(
                "/credit/types-map",
                {"activityId": activityId},
                operation="get_creditType_list2",
            )
        except LocalApiError:
            return None

    def get_sign_list(self, activityId: str, type: int) -> list | None:
        try:
            return self._client.get(
                "/sign/list",
                {"activityId": activityId, "type": str(type)},
                operation="get_sign_list",
            )
        except LocalApiError:
            return None

    def get_credit_list(self, url: str, activityId: str, scoreId: str) -> list | None:
        try:
            return self._client.post(
                "/credit/list",
                {"url": url, "activityId": activityId, "scoreId": scoreId},
                operation="get_credit_list",
            )
        except LocalApiError:
            return None

    def send_credit(self, activityId: str, scoreId: str, userList: str) -> bool:
        if userList == "":
            raise ValueError("userList 不能为空")
        try:
            return bool(
                self._client.post(
                    "/credit/send",
                    {
                        "activityId": activityId,
                        "scoreId": scoreId,
                        "userList": userList,
                    },
                    operation="send_credit",
                )
            )
        except LocalApiError:
            return False

    def send_creditByname(
        self, activityId: str, scoreId: str, usernameList: list
    ) -> bool | None:
        try:
            return self._client.post(
                "/credit/send-by-name",
                {
                    "activityId": activityId,
                    "scoreId": scoreId,
                    "usernameList": usernameList,
                },
                operation="send_creditByname",
            )
        except LocalApiError:
            return None

    def send_creditBy_signUpId(
        self, activityId: str, scoreId: str, signUpIdList: list
    ) -> bool | None:
        try:
            data = self._client.post(
                "/credit/send-by-signup-id",
                {
                    "activityId": activityId,
                    "scoreId": scoreId,
                    "signUpIdList": signUpIdList,
                },
                operation="send_creditBy_signUpId",
            )
        except LocalApiError:
            return None

        if isinstance(data, list) and len(data) == 2:
            return data[0], data[1]
        return data

    def find_not_send_credited_mem_by_signUpId(
        self, activityId: str, scoreId: str, signUpId_list: list
    ) -> tuple[dict, dict]:
        try:
            data = self._client.post(
                "/credit/find-not-sent",
                {
                    "activityId": activityId,
                    "scoreId": scoreId,
                    "signUpId_list": signUpId_list,
                },
                operation="find_not_send_credited_mem_by_signUpId",
            )
        except LocalApiError:
            return {}, {}

        if isinstance(data, list) and len(data) == 2:
            return data[0], data[1]
        return {}, {}

    def export_mem_excel(self, activityId: str, type: int):
        try:
            return self._client.get_bytes(
                "/export/members",
                {"activityId": activityId, "type": str(type)},
                operation="export_mem_excel",
            )
        except LocalApiError:
            return None

    def generate_signcard(
        self,
        activityId: str,
        signId: str = "",
        latitude: str = "39.91552570951688",
        longitude: str = "116.403847106168",
        encryption: bool = False,
        pwd: str = "0",
        qrCode: str = "0",
        desc: str = "",
    ):
        try:
            return self._client.post(
                "/sign/card",
                {
                    "activityId": activityId,
                    "signId": signId,
                    "latitude": latitude,
                    "longitude": longitude,
                    "encryption": encryption,
                    "pwd": pwd,
                    "qrCode": qrCode,
                    "desc": desc,
                },
                operation="generate_signcard",
            )
        except LocalApiError:
            return None

    def get_uid_and_token_from_export_url(self, url: str):
        if not url.startswith(
            "https://apph5.5idream.net/apih5/api/activity/join/export?activityid="
        ):
            raise ValueError("URL格式不正确，必须是活动导出URL")

        parsed_url = urlparse(url)
        query_params = parse_qs(parsed_url.query)

        if "api_token" not in query_params:
            raise ValueError("URL中缺少api_token参数")

        api_token = query_params["api_token"][0]

        if not api_token:
            raise ValueError("api_token参数为空")

        try:
            data = self._client.post(
                "/session/import-export-url",
                {"url": url},
                operation="get_uid_and_token_from_export_url",
            )
        except LocalApiError as exc:
            raise ValueError(str(exc)) from exc

        self.uid = str(data.get("uid", ""))
        self.token = str(data.get("token", ""))
        self._save_login_config(uid=self.uid, token=self.token)
        return self.uid, self.token

    def __init__(self, config_path):
        self.config_path = config_path
        self._server_manager = None
        self._owns_server_reference = False
        self._config = configparser.ConfigParser()
        if os.path.isfile(config_path):
            self._config.read(config_path, encoding="utf-8")

        base_url = self._get_local_base_url()
        exe_path = self._get_local_exe_path()
        if not self._autostart_disabled():
            if DMAPI._shared_server_manager is None:
                DMAPI._shared_server_manager = DMLocalServerManager(
                    base_url=base_url,
                    exe_path=exe_path,
                )
            self._server_manager = DMAPI._shared_server_manager
            base_url = self._server_manager.ensure_running()
            DMAPI._shared_server_ref_count += 1
            self._owns_server_reference = True

        self._client = DMLocalClient(base_url=base_url, config_path=config_path)
        self.uid = ""
        self.token = ""

        login_config = self._get_login_config()
        self.uid = login_config["uid"]
        self.token = login_config["token"]

        if self.uid and self.token:
            try:
                self._client.post(
                    "/session",
                    {"uid": self.uid, "token": self.token},
                    operation="restore_session",
                )
            except LocalApiError:
                pass
            else:
                if self.get_activityList():
                    return
                print("登录态已失效，正在重新登录")

        while True:
            user_input = input("是否共用手机登录状态？(y/n/直接粘贴URL)：").strip()
            if not user_input:
                print("输入不能为空，请重新输入")
                continue

            if user_input.startswith("y"):
                url = input(
                    "请输入来自管理活动-人员管理-导出后跳转到浏览器的url：\n"
                ).strip()
                while not url:
                    print("URL不能为空，请重新输入")
                    url = input(
                        "请输入来自管理活动-人员管理-导出后跳转到浏览器的url：\n"
                    ).strip()
                try:
                    self.get_uid_and_token_from_export_url(url)
                    break
                except ValueError as exc:
                    print(f"URL验证失败: {exc}")
            elif user_input.startswith("n"):
                account, pwd = self._get_account_and_pwd()
                if not account or not pwd:
                    account, pwd = self._prompt_account_and_password()

                while not self.login(account, pwd):
                    print("登录失败，请重新输入账号密码")
                    account, pwd = self._prompt_account_and_password()
                break
            elif user_input.startswith(
                "https://apph5.5idream.net/apih5/api/activity/join/export?activityid="
            ):
                try:
                    self.get_uid_and_token_from_export_url(user_input)
                    break
                except ValueError as exc:
                    print(f"URL验证失败: {exc}")
            else:
                print("输入无效，请输入y、n或有效的导出URL")

    def __del__(self):
        try:
            self._stop_server()
        except Exception:
            pass

    def _get_login_config(self):
        if self._config.has_section("login"):
            return {
                "uid": str(self._config["login"].get("uid", "")),
                "token": str(self._config["login"].get("token", "")),
                "account": str(self._config["login"].get("account", "")),
                "pwd": str(self._config["login"].get("pwd", "")),
            }
        return {"uid": "", "token": "", "account": "", "pwd": ""}

    def _get_account_and_pwd(self):
        login_config = self._get_login_config()
        return login_config["account"], login_config["pwd"]

    def _prompt_account_and_password(self):
        account = input("请输入账号（手机号/身份证号）：").strip()
        pwd = input("请输入密码：").strip()
        self._save_login_config(account=account, pwd=pwd)
        return account, pwd

    def _save_login_config(self, uid="", token="", account="", pwd=""):
        if not self._config.has_section("login"):
            self._config.add_section("login")
        if uid:
            self._config["login"]["uid"] = uid
        if token:
            self._config["login"]["token"] = token
        if account:
            self._config["login"]["account"] = account
        if pwd:
            self._config["login"]["pwd"] = pwd
        with open(self.config_path, "w", encoding="utf-8") as file:
            self._config.write(file)

    def _stop_server(self):
        if self._server_manager is None:
            return
        if self._owns_server_reference:
            DMAPI._shared_server_ref_count = max(0, DMAPI._shared_server_ref_count - 1)
            self._owns_server_reference = False
            if DMAPI._shared_server_ref_count == 0:
                self._server_manager.close()
                if DMAPI._shared_server_manager is self._server_manager:
                    DMAPI._shared_server_manager = None
        self._server_manager = None

    def _get_local_base_url(self):
        base_url = os.environ.get("DMLOCALAPI_BASE_URL")
        if base_url:
            return base_url
        if self._config.has_section("local_server"):
            return self._config.get("local_server", "base_url", fallback=None)
        return None

    def _get_local_exe_path(self):
        exe_path = os.environ.get("DMLOCALAPI_SERVER_EXE")
        if exe_path:
            return exe_path
        if self._config.has_section("local_server"):
            return self._config.get("local_server", "exe_path", fallback=None)
        return None

    def _autostart_disabled(self):
        value = os.environ.get("DMLOCALAPI_DISABLE_AUTOSTART", "")
        return value.lower() in {"1", "true", "yes", "on"}
