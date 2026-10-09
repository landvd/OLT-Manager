import { createApp } from "vue";
import { ElAlert } from "element-plus/es/components/alert/index.mjs";
import { ElAutocomplete } from "element-plus/es/components/autocomplete/index.mjs";
import { ElButton } from "element-plus/es/components/button/index.mjs";
import { ElCard } from "element-plus/es/components/card/index.mjs";
import { ElCol } from "element-plus/es/components/col/index.mjs";
import { ElConfigProvider } from "element-plus/es/components/config-provider/index.mjs";
import { ElDatePicker } from "element-plus/es/components/date-picker/index.mjs";
import { ElDialog } from "element-plus/es/components/dialog/index.mjs";
import { ElEmpty } from "element-plus/es/components/empty/index.mjs";
import { ElIcon } from "element-plus/es/components/icon/index.mjs";
import { ElInput } from "element-plus/es/components/input/index.mjs";
import { ElInputNumber } from "element-plus/es/components/input-number/index.mjs";
import { ElLoading } from "element-plus/es/components/loading/index.mjs";
import { ElPagination } from "element-plus/es/components/pagination/index.mjs";
import { ElProgress } from "element-plus/es/components/progress/index.mjs";
import { ElRow } from "element-plus/es/components/row/index.mjs";
import { ElSwitch } from "element-plus/es/components/switch/index.mjs";
import { ElDropdown, ElDropdownItem, ElDropdownMenu } from "element-plus/es/components/dropdown/index.mjs";
import { ElTag } from "element-plus/es/components/tag/index.mjs";
import { ElAside, ElContainer, ElHeader, ElMain } from "element-plus/es/components/container/index.mjs";
import { ElCheckbox, ElCheckboxButton, ElCheckboxGroup } from "element-plus/es/components/checkbox/index.mjs";
import { ElRadio, ElRadioButton, ElRadioGroup } from "element-plus/es/components/radio/index.mjs";
import { ElDescriptions, ElDescriptionsItem } from "element-plus/es/components/descriptions/index.mjs";
import { ElForm, ElFormItem } from "element-plus/es/components/form/index.mjs";
import { ElMenu, ElMenuItem } from "element-plus/es/components/menu/index.mjs";
import { ElOption, ElSelect } from "element-plus/es/components/select/index.mjs";
import { ElTable, ElTableColumn } from "element-plus/es/components/table/index.mjs";
import { ElStep, ElSteps } from "element-plus/es/components/steps/index.mjs";
import { ArrowDown, ArrowRight, ArrowUp, Box, Brush, ChatDotRound, CircleCheck, CircleClose, CirclePlus, Close, CopyDocument, Cpu, Delete, Document, Download, Edit, FolderChecked, InfoFilled, Grid, Guide, Location, Lock, MagicStick, Monitor, Odometer, Opportunity, Plus, Refresh, Right, Search, Setting, SuccessFilled, Suitcase, Tickets, Timer, TrendCharts, Upload, User, VideoPlay, View, Warning, ZoomIn } from "@element-plus/icons-vue";
import App from "./App.vue";
import "element-plus/dist/index.css";
import "./styles.css";

const app = createApp(App);
for (const [name, component] of Object.entries({
  "el-alert": ElAlert,
  "el-aside": ElAside,
  "el-autocomplete": ElAutocomplete,
  "el-button": ElButton,
  "el-card": ElCard,
  "el-checkbox": ElCheckbox,
  "el-checkbox-button": ElCheckboxButton,
  "el-checkbox-group": ElCheckboxGroup,
  "el-col": ElCol,
  "el-config-provider": ElConfigProvider,
  "el-container": ElContainer,
  "el-date-picker": ElDatePicker,
  "el-descriptions": ElDescriptions,
  "el-descriptions-item": ElDescriptionsItem,
  "el-dialog": ElDialog,
  "el-empty": ElEmpty,
  "el-icon": ElIcon,
  "el-form": ElForm,
  "el-form-item": ElFormItem,
  "el-header": ElHeader,
  "el-input": ElInput,
  "el-input-number": ElInputNumber,
  "el-main": ElMain,
  "el-menu": ElMenu,
  "el-menu-item": ElMenuItem,
  "el-option": ElOption,
  "el-pagination": ElPagination,
  "el-progress": ElProgress,
  "el-row": ElRow,
  "el-select": ElSelect,
  "el-switch": ElSwitch,
  "el-dropdown": ElDropdown,
  "el-dropdown-item": ElDropdownItem,
  "el-dropdown-menu": ElDropdownMenu,
  "el-table": ElTable,
  "el-table-column": ElTableColumn,
  "el-tag": ElTag,
  "el-steps": ElSteps,
  "el-step": ElStep,
  "el-radio": ElRadio,
  "el-radio-button": ElRadioButton,
  "el-radio-group": ElRadioGroup
})) app.component(name, component);
// 界面统一使用 Element Plus 线性图标（替代 emoji），按需全局注册。
for (const [name, component] of Object.entries({ ArrowDown, ArrowRight, ArrowUp, Box, Brush, ChatDotRound, CircleCheck, CircleClose, CirclePlus, Close, CopyDocument, Cpu, Delete, Document, Download, Edit, FolderChecked, InfoFilled, Grid, Guide, Location, Lock, MagicStick, Monitor, Odometer, Opportunity, Plus, Refresh, Right, Search, Setting, SuccessFilled, Suitcase, Tickets, Timer, TrendCharts, Upload, User, VideoPlay, View, Warning, ZoomIn })) app.component(name, component);
app.directive("loading", ElLoading.directive);
app.mount("#app");
