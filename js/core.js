// Core global config for FarmVista
// Menu data + version (single source of truth for Step 1)
window.FV_VERSION = "v0.1.0";

window.FV_MENU = [
  { id:"home", label:"Home", icon:"home", children:[] },
  {
    id:"application-records", label:"Application Records", icon:"clipboard",
    children:[
      { id:"spray-logs", label:"Spray Logs" },
      { id:"planting-logs", label:"Planting Logs" },
      { id:"fertilizer-logs", label:"Fertilizer Logs" },
      { id:"trials", label:"Trials" },
      { id:"harvest-logs", label:"Harvest Logs" }
    ]
  },
  {
    id:"equipment", label:"Equipment", icon:"tractor",
    children:[
      { id:"tractors", label:"Tractors" },
      { id:"combines", label:"Combines" },
      { id:"sprayers", label:"Sprayers" },
      { id:"implements", label:"Implements" },
      { id:"maintenance", label:"Maintenance" }
    ]
  },
  {
    id:"grain", label:"Grain", icon:"silo",
    children:[
      { id:"bins", label:"Bins" },
      { id:"bags", label:"Bags" },
      { id:"contracts", label:"Contracts" },
      { id:"tickets-ocr", label:"Tickets OCR" },
      { id:"shipments", label:"Shipments" }
    ]
  },
  {
    id:"setup", label:"Setup", icon:"gear",
    children:[
      { id:"farms", label:"Farms" },
      { id:"fields", label:"Fields" },
      { id:"crop-types", label:"Crop Types" },
      { id:"products", label:"Products" },
      { id:"roles", label:"Roles" },
      { id:"theme", label:"Theme" }
    ]
  },
  {
    id:"teams-partners", label:"Teams & Partners", icon:"users",
    children:[
      { id:"employees", label:"Employees" },
      { id:"vendors", label:"Vendors" },
      { id:"sub-contractors", label:"Sub-Contractors" },
      { id:"partners", label:"Partners" }
    ]
  }
];
